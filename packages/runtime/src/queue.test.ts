import { commandSlot } from './program.js';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { modelOwner } from './owner.js';
import { defineTasks } from './tasks.js';
import { controlledEffect } from './testing.js';

const commandSave = commandSlot('save');

it.each(['queue', 'latest-queued'] as const)(
  '%s owns ordered writes and keeps awaitIdle pending through the last write',
  async (policy) => {
    const app = modelOwner({});
    const pending = controlledEffect<void>();
    const calls: string[] = [];
    const actions = defineTasks(app, {
      save: {
        slot: commandSave,
        policy,
        run: (text: string) => {
          calls.push(text);
          return pending.effect;
        },
      },
    });
    actions.save('first');
    actions.save('second');
    actions.save('third');
    let idle = false;
    const wait = app.awaitIdle().then(() => {
      idle = true;
    });
    expect(calls).toEqual(['first']);
    pending.succeed(undefined);
    await vi.waitFor(() =>
      expect(calls).toEqual(policy === 'queue' ? ['first', 'second'] : ['first', 'third']),
    );
    expect(idle).toBe(false);
    expect(app.isRunning(commandSave)).toBe(true);
    pending.succeed(undefined);
    if (policy === 'queue') {
      await vi.waitFor(() => expect(calls).toEqual(['first', 'second', 'third']));
      expect(idle).toBe(false);
      pending.succeed(undefined);
    }
    await wait;
    expect(app.isRunning(commandSave)).toBe(false);
    app.dispose();
  },
);

it.each(['failure', 'defect'] as const)('advances queued writes after a %s', async (kind) => {
  const report = vi.fn();
  const app = modelOwner({}, { onDefect: report });
  const pending = controlledEffect<void, string>();
  const completed = vi.fn();
  app.run(commandSave, pending.effect, 'queue');
  app.run(commandSave, Effect.sync(completed), 'queue');
  if (kind === 'failure') pending.fail('offline');
  else pending.die('broken');
  await app.awaitIdle();
  expect(report).toHaveBeenCalledOnce();
  expect(completed).toHaveBeenCalledOnce();
  app.dispose();
});

it.each(['cancel', 'dispose', 'replace'] as const)(
  '%s discards queued writes and ignores stale completions',
  async (action) => {
    const app = modelOwner({ value: '' });
    let resume!: (effect: Effect.Effect<void>) => void;
    const pending = Effect.callback<void>((callback) => {
      resume = callback;
    });
    const queued = vi.fn<() => void>();
    app.run(commandSave, pending, 'queue');
    app.run(commandSave, Effect.sync(queued), 'queue');
    if (action === 'dispose') app.dispose();
    else if (action === 'cancel') app.cancel(commandSave);
    else
      app.run(
        commandSave,
        Effect.sync(() => app.patch({ value: 'new' })),
        'replace',
      );
    resume(Effect.void);
    await app.awaitIdle();
    expect(queued).not.toHaveBeenCalled();
    expect(app.read().value).toBe(action === 'replace' ? 'new' : '');
    app.dispose();
  },
);

it.each(['queue', 'latest-queued'] as const)(
  'component %s captures fields and inputs when submitted and publishes waiting through failures',
  async (policy) => {
    const pending = controlledEffect<string, string>();
    const calls: string[] = [];
    const definition = defineTasks({ init: () => ({ text: 'one' }) }).tasks({
      save: {
        policy,
        run: (model, suffix: string) => {
          calls.push(model.text + suffix);
          return pending.effect;
        },
      },
    });
    const source = definition.create(undefined);
    const actions = definition.controls(source.send);
    actions.run('save', '!');
    actions.patch({ text: 'two' });
    actions.run('save', '?');
    actions.patch({ text: 'three' });
    actions.run('save', '.');
    actions.patch({ text: 'four' });
    expect(calls).toEqual(['one!']);
    pending.fail('offline');
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(source.model().tasks.save.waiting).toBe(true);
    expect(AsyncResult.isFailure(source.model().tasks.save)).toBe(true);
    expect(calls[1]).toBe(policy === 'queue' ? 'two?' : 'three.');
    pending.succeed('saved');
    if (policy === 'queue') {
      await vi.waitFor(() => expect(calls[2]).toBe('three.'));
      expect(source.model().tasks.save.waiting).toBe(true);
      pending.succeed('latest');
    }
    await source.awaitIdle();
    expect(source.model().tasks.save.waiting).toBe(false);
    expect(source.model().text).toBe('four');
    source.dispose();
  },
);

it.each(['reset', 'identity', 'dispose'] as const)(
  'component %s clears both active and queued work',
  async (action) => {
    const pending = controlledEffect<void>();
    const calls = vi.fn(() => pending.effect);
    const definition = defineTasks({
      init: (props: { id: string }) => ({ text: props.id }),
      identity: (props) => props.id,
    }).tasks({ save: { policy: 'queue', run: calls } });
    const source = definition.create({ id: 'one' });
    const actions = definition.controls(source.send);
    actions.run('save');
    actions.run('save');
    if (action === 'reset') actions.reset('save');
    else if (action === 'identity') definition.receive(source, { id: 'two' });
    else source.dispose();
    await source.awaitIdle();
    expect(calls).toHaveBeenCalledOnce();
    if (action !== 'dispose') expect(AsyncResult.isInitial(source.model().tasks.save)).toBe(true);
    source.dispose();
  },
);

it('retains the preceding successful write when a queued write fails', async () => {
  const pending = controlledEffect<string, string>();
  const definition = defineTasks({ init: () => ({}) }).tasks({
    save: { policy: 'queue', run: () => pending.effect },
  });
  const source = definition.create(undefined);
  const actions = definition.controls(source.send);
  actions.run('save');
  actions.run('save');
  pending.succeed('first saved');
  await vi.waitFor(() => expect(pending.pending()).toBe(1));
  pending.fail('offline');
  await source.awaitIdle();
  const result = source.model().tasks.save;
  expect(AsyncResult.isFailure(result)).toBe(true);
  expect(AsyncResult.value(result)).toMatchObject({ _tag: 'Some', value: 'first saved' });
  source.dispose();
});

it('admits batch queue policies before starting work and drains large synchronous queues', async () => {
  const app = modelOwner({});
  let count = 0;
  app.transaction(() => {
    for (let i = 0; i < 2000; i++)
      app.run(
        commandSave,
        Effect.sync(() => {
          count++;
        }),
        'queue',
      );
  });
  await app.awaitIdle();
  expect(count).toBe(2000);
  const calls: number[] = [];
  app.transaction(() => {
    for (let i = 0; i < 10; i++)
      app.run(
        commandSave,
        Effect.sync(() => {
          calls.push(i);
        }),
        'latest-queued',
      );
  });
  await app.awaitIdle();
  expect(calls).toEqual([0, 9]);
  app.dispose();
});

it('preserves queue policy through service provisioning and command mapping', async () => {
  const { Context } = await import('effect');
  const { mapCommand } = await import('./program.js');
  const { uiRuntime } = await import('./runtime.js');
  class Store extends Context.Service<Store, { save: typeof pending.effect }>()('QueueStore') {}
  const pending = controlledEffect<string>();
  const runtime = uiRuntime(Context.make(Store, { save: pending.effect }));
  const source = runtime.program({
    initial: '',
    update: (model: string, message: string) =>
      message === 'run'
        ? {
            model,
            commands: [
              mapCommand(
                {
                  slot: commandSave,
                  policy: 'queue',
                  effect: Effect.flatMap(Store, (store) => store.save),
                },
                (value) => `saved:${value}`,
              ),
            ],
          }
        : { model: message },
  });
  source.send('run');
  source.send('run');
  expect(pending.pending()).toBe(1);
  pending.succeed('one');
  await vi.waitFor(() => expect(source.model()).toBe('saved:one'));
  expect(pending.pending()).toBe(1);
  pending.succeed('two');
  await source.awaitIdle();
  expect(source.model()).toBe('saved:two');
  source.dispose();
});

it('suppresses synchronous completion messages already queued behind reset or replacement', async () => {
  const { program } = await import('./program.js');
  type Message = 'run' | 'cancel' | 'replace' | 'stale' | 'fresh';
  for (const action of ['cancel', 'replace'] as const) {
    const source = program<string, Message>({
      initial: '',
      update: (model, message) => {
        if (message === 'cancel') return { model: 'canceled', cancel: [commandSave] };
        if (message === 'run')
          return {
            model,
            commands: [
              {
                slot: commandSave,
                policy: 'queue',
                effect: Effect.sync(() => {
                  source.send(action);
                  return 'stale' as const;
                }),
              },
            ],
          };
        if (message === 'replace')
          return {
            model,
            commands: [
              { policy: 'replace', slot: commandSave, effect: Effect.succeed('fresh' as const) },
            ],
          };
        return { model: message };
      },
    });
    const seen: string[] = [];
    source.subscribe((model) => seen.push(model));
    source.send('run');
    await source.awaitIdle();
    expect(seen).not.toContain('stale');
    expect(source.model()).toBe(action === 'cancel' ? 'canceled' : 'fresh');
    source.dispose();
  }
});

it('waits for all parallel work in a shared slot before starting queued work', async () => {
  const app = modelOwner({});
  const first = controlledEffect<void>();
  const second = controlledEffect<void>();
  const queued = vi.fn<() => void>();
  app.run(commandSave, first.effect, 'parallel');
  app.run(commandSave, second.effect, 'parallel');
  app.run(commandSave, Effect.sync(queued), 'queue');
  first.succeed(undefined);
  await Promise.resolve();
  expect(queued).not.toHaveBeenCalled();
  second.succeed(undefined);
  await app.awaitIdle();
  expect(queued).toHaveBeenCalledOnce();
  app.dispose();
});

it.each(['queue', 'latest-queued'] as const)(
  '%s processes earlier cancellation and replacement before starting the next synchronous write',
  async (policy) => {
    const { program } = await import('./program.js');
    type Message = 'run' | 'cancel' | 'replace' | 'first' | 'second' | 'fresh';
    for (const origin of ['effect', 'subscriber'] as const) {
      for (const action of ['cancel', 'replace'] as const) {
        const calls: string[] = [];
        const seen: string[] = [];
        const waiters: Promise<void>[] = [];
        const source = program<string, Message>({
          initial: '',
          update: (model, message) => {
            if (message === 'run')
              return {
                model,
                commands: [
                  {
                    slot: commandSave,
                    policy,
                    effect: Effect.sync(() => {
                      calls.push('first');
                      if (origin === 'effect') source.send(action);
                      return 'first' as const;
                    }),
                  },
                  {
                    slot: commandSave,
                    policy,
                    effect: Effect.sync(() => {
                      calls.push('second');
                      return 'second' as const;
                    }),
                  },
                ],
              };
            if (message === 'cancel') return { model: 'canceled', cancel: [commandSave] };
            if (message === 'replace')
              return {
                model,
                commands: [
                  {
                    policy: 'replace',
                    slot: commandSave,
                    effect: Effect.sync(() => {
                      calls.push('fresh');
                      return 'fresh' as const;
                    }),
                  },
                ],
              };
            return { model: message };
          },
        });
        source.subscribe((model) => {
          seen.push(model);
          waiters.push(source.awaitIdle(commandSave));
          if (origin === 'subscriber' && model === 'first') source.send(action);
        });
        source.send('run');
        await Promise.all([...waiters, source.awaitIdle()]);
        expect(calls).toEqual(action === 'cancel' ? ['first'] : ['first', 'fresh']);
        expect(seen).not.toContain('second');
        expect(source.model()).toBe(action === 'cancel' ? 'canceled' : 'fresh');
        source.dispose();
      }
    }
  },
);

it('releases deferred queued work when its completion reducer throws', async () => {
  const { program } = await import('./program.js');
  const queued = vi.fn<() => void>();
  const source = program({
    initial: 0,
    update: (model: number, message: string) => {
      if (message === 'done') throw new Error('completion reducer');
      return {
        model,
        commands: [
          { slot: commandSave, policy: 'queue', effect: Effect.succeed('done') },
          { slot: commandSave, policy: 'queue', action: Effect.sync(queued) },
        ] as const,
      };
    },
  });
  expect(() => source.send('run')).toThrow('completion reducer');
  await source.awaitIdle();
  expect(queued).not.toHaveBeenCalled();
  expect(source.activeSlots()).toEqual([]);
  source.dispose();
});

it('latest-queued replaces pending work submitted by a synchronous completion subscriber', async () => {
  const { program } = await import('./program.js');
  const calls: string[] = [];
  const write = (value: string) => ({
    slot: commandSave,
    policy: 'latest-queued' as const,
    effect: Effect.sync(() => {
      calls.push(value);
      return value;
    }),
  });
  const source = program({
    initial: '',
    update: (model: string, message: string) => {
      if (message === 'run') return { model, commands: [write('first'), write('outdated')] };
      if (message === 'latest') return { model, commands: [write('newest')] };
      return { model: message };
    },
  });
  source.subscribe((model) => {
    if (model === 'first') source.send('latest');
  });
  source.send('run');
  await source.awaitIdle();
  expect(calls).toEqual(['first', 'newest']);
  expect(source.model()).toBe('newest');
  source.dispose();
});

it('captures queued argument references and lets callers submit an owned immutable value', async () => {
  const owner = modelOwner({});
  const gate = controlledEffect<void>();
  const seen: string[] = [];
  const tasks = defineTasks(owner, {
    save: {
      slot: commandSave,
      policy: 'queue',
      run: (input: { text: string }) =>
        Effect.sync(() => {
          seen.push(input.text);
        }),
    },
  });
  owner.run(commandSave, gate.effect, 'queue');
  const draft = { text: 'accepted' };
  tasks.save({ ...draft });
  tasks.save(draft);
  draft.text = 'edited later';
  gate.succeed(undefined);
  await owner.awaitIdle();
  expect(seen).toEqual(['accepted', 'edited later']);
  owner.dispose();
});
