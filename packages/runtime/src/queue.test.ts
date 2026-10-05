import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner } from './owner.js';
import { controlledEffect } from './testing.js';

const commandSave = 'save';

it.each(['queue', 'latest-queued'] as const)(
  '%s owns ordered writes and keeps awaitIdle pending through the last write',
  async (policy) => {
    const app = modelOwner({});
    const pending = controlledEffect<void>();
    const calls: string[] = [];
    const save = (text: string) =>
      app.run(
        commandSave,
        Effect.suspend(() => {
          calls.push(text);
          return pending.effect;
        }),
        policy,
      );
    void save('first');
    void save('second');
    void save('third');
    let idle = false;
    const wait = Effect.runPromise(app.awaitIdle()).then(() => {
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
  await Effect.runPromise(app.awaitIdle());
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
    await Effect.runPromise(app.awaitIdle());
    expect(queued).not.toHaveBeenCalled();
    expect(app.read().value).toBe(action === 'replace' ? 'new' : '');
    app.dispose();
  },
);

it.each(['queue', 'latest-queued'] as const)(
  'task %s captures values when submitted and publishes waiting through failures',
  async (policy) => {
    const pending = controlledEffect<string, string>();
    const calls: string[] = [];
    const owner = modelOwner<{ text: string; saved: AsyncResult.AsyncResult<string, string> }>({
      text: 'one',
      saved: AsyncResult.initial(),
    });
    const save = (suffix: string) => {
      const text = owner.read().text + suffix;
      return owner.task(
        'saved',
        Effect.suspend(() => {
          calls.push(text);
          return pending.effect;
        }),
        policy,
      );
    };
    void save('!');
    owner.patch({ text: 'two' });
    void save('?');
    owner.patch({ text: 'three' });
    void save('.');
    owner.patch({ text: 'four' });
    expect(calls).toEqual(['one!']);
    pending.fail('offline');
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(owner.read().saved.waiting).toBe(true);
    expect(AsyncResult.isFailure(owner.read().saved)).toBe(true);
    expect(calls[1]).toBe(policy === 'queue' ? 'two?' : 'three.');
    pending.succeed('saved');
    if (policy === 'queue') {
      await vi.waitFor(() => expect(calls[2]).toBe('three.'));
      expect(owner.read().saved.waiting).toBe(true);
      pending.succeed('latest');
    }
    await Effect.runPromise(owner.awaitIdle());
    expect(owner.read().saved.waiting).toBe(false);
    expect(owner.read().text).toBe('four');
    owner.dispose();
  },
);

it.each(['cancel', 'dispose'] as const)(
  'task %s clears both active and queued work',
  async (action) => {
    const pending = controlledEffect<void>();
    const calls = vi.fn(() => pending.effect);
    const owner = modelOwner<{ saved: AsyncResult.AsyncResult<void, never> }>({
      saved: AsyncResult.initial(),
    });
    owner.task('saved', Effect.suspend(calls), 'queue');
    owner.task('saved', Effect.suspend(calls), 'queue');
    if (action === 'cancel') owner.cancel('saved');
    else owner.dispose();
    await Effect.runPromise(owner.awaitIdle());
    expect(calls).toHaveBeenCalledOnce();
    if (action === 'cancel') {
      expect(AsyncResult.isInitial(owner.read().saved)).toBe(true);
      expect(owner.read().saved.waiting).toBe(false);
    }
    owner.dispose();
  },
);

it('retains the preceding successful write when a queued write fails', async () => {
  const pending = controlledEffect<string, string>();
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<string, string> }>({
    saved: AsyncResult.initial(),
  });
  owner.task('saved', pending.effect, 'queue');
  owner.task('saved', pending.effect, 'queue');
  pending.succeed('first saved');
  await vi.waitFor(() => expect(pending.pending()).toBe(1));
  pending.fail('offline');
  await Effect.runPromise(owner.awaitIdle());
  const result = owner.read().saved;
  expect(AsyncResult.isFailure(result)).toBe(true);
  expect(AsyncResult.value(result)).toMatchObject({ _tag: 'Some', value: 'first saved' });
  owner.dispose();
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
  await Effect.runPromise(app.awaitIdle());
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
  await Effect.runPromise(app.awaitIdle());
  expect(calls).toEqual([0, 9]);
  app.dispose();
});

it('preserves queue policy through service provisioning and command mapping', async () => {
  const { Context } = await import('effect');
  const { mapCommand, program } = await import('./program.js');
  class Store extends Context.Service<Store, { save: typeof pending.effect }>()('QueueStore') {}
  const pending = controlledEffect<string>();
  const source = program({
    context: Context.make(Store, { save: pending.effect }),
    initial: '',
    update: (model: string, message: string) =>
      message === 'run'
        ? {
            model,
            commands: [
              mapCommand(
                {
                  key: commandSave,
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
  await Effect.runPromise(source.awaitIdle());
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
                key: commandSave,
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
              { policy: 'replace', key: commandSave, effect: Effect.succeed('fresh' as const) },
            ],
          };
        return { model: message };
      },
    });
    const seen: string[] = [];
    source.subscribe((model) => seen.push(model));
    source.send('run');
    await Effect.runPromise(source.awaitIdle());
    expect(seen).not.toContain('stale');
    expect(source.model()).toBe(action === 'cancel' ? 'canceled' : 'fresh');
    source.dispose();
  }
});

it('waits for all parallel work under a shared key before starting queued work', async () => {
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
  await Effect.runPromise(app.awaitIdle());
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
                    key: commandSave,
                    policy,
                    effect: Effect.sync(() => {
                      calls.push('first');
                      if (origin === 'effect') source.send(action);
                      return 'first' as const;
                    }),
                  },
                  {
                    key: commandSave,
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
                    key: commandSave,
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
          waiters.push(Effect.runPromise(source.awaitIdle(commandSave)));
          if (origin === 'subscriber' && model === 'first') source.send(action);
        });
        source.send('run');
        await Promise.all([...waiters, Effect.runPromise(source.awaitIdle())]);
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
          { key: commandSave, policy: 'queue', effect: Effect.succeed('done') },
          { key: commandSave, policy: 'queue', effect: Effect.sync(queued) },
        ] as const,
      };
    },
  });
  expect(() => source.send('run')).toThrow('completion reducer');
  await Effect.runPromise(source.awaitIdle());
  expect(queued).not.toHaveBeenCalled();
  expect(source.activeKeys()).toEqual([]);
  source.dispose();
});

it('latest-queued replaces pending work submitted by a synchronous completion subscriber', async () => {
  const { program } = await import('./program.js');
  const calls: string[] = [];
  const write = (value: string) => ({
    key: commandSave,
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
  await Effect.runPromise(source.awaitIdle());
  expect(calls).toEqual(['first', 'newest']);
  expect(source.model()).toBe('newest');
  source.dispose();
});

it('captures queued argument references and lets callers submit an owned immutable value', async () => {
  const owner = modelOwner({});
  const gate = controlledEffect<void>();
  const seen: string[] = [];
  const save = (input: { text: string }) =>
    owner.run(
      commandSave,
      Effect.sync(() => {
        seen.push(input.text);
      }),
      'queue',
    );
  owner.run(commandSave, gate.effect, 'queue');
  const draft = { text: 'accepted' };
  void save({ ...draft });
  void save(draft);
  draft.text = 'edited later';
  gate.succeed(undefined);
  await Effect.runPromise(owner.awaitIdle());
  expect(seen).toEqual(['accepted', 'edited later']);
  owner.dispose();
});
