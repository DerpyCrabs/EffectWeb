import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { component, programView } from './component.js';
import { attach, compiled, Scope, type View } from './dom.js';
import { domMount } from './mount.js';
import { commandSlot, program, type Send } from './program.js';
import { defineTasks } from './tasks.js';

type Props = { id: string };
type Model = { props: Props; count: number };
const parent = {} as Node;

for (const kind of ['component', 'programView'] as const) {
  it(`joins nested DOM finalizers in ${kind}`, async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finalized = vi.fn();
    const inner = compiled<Model, number>((scope) => {
      attach(
        scope,
        new EventTarget() as HTMLElement,
        () => [],
        () =>
          domMount(() =>
            Effect.never.pipe(
              Effect.ensuring(
                Effect.promise(() => gate).pipe(Effect.andThen(Effect.sync(finalized))),
              ),
            ),
          ),
      );
    });
    const definition =
      kind === 'component'
        ? component({
            init: (props: Props) => ({ props, count: 0 }),
            update: (model: Model) => ({ model }),
            view: inner,
          })
        : programView({
            create: (props: Props) =>
              program({ initial: { props, count: 0 }, update: (model: Model) => ({ model }) }),
            receive: () => {},
            view: inner,
          });
    const scope = new Scope<Props, never>({ id: 'a' }, () => {});
    definition.build(scope, parent, null);
    await Promise.resolve();
    scope.dispose();
    let settled = false;
    const closing = Effect.runPromise(scope.settlement.wait()).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(finalized).not.toHaveBeenCalled();
    release();
    await closing;
    expect(finalized).toHaveBeenCalledTimes(1);
  });

  it(`joins active and previously replaced command finalizers in ${kind}`, async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finalized: number[] = [];
    const slot = commandSlot('work');
    let send!: Send<number>;
    const inner = compiled<Model, number>((scope) => {
      send = scope.send;
    });
    const update = (model: Model, count: number) => ({
      model: { ...model, count },
      commands: [
        {
          slot,
          policy: 'replace' as const,
          effect: Effect.never.pipe(
            Effect.ensuring(
              Effect.promise(async () => {
                await gate;
                finalized.push(count);
              }),
            ),
          ),
        },
      ],
    });
    const definition =
      kind === 'component'
        ? component({ init: (props: Props) => ({ props, count: 0 }), update, view: inner })
        : programView({
            create: (props: Props) => program({ initial: { props, count: 0 }, update }),
            receive: () => {},
            view: inner,
          });
    const scope = new Scope<Props, never>({ id: 'a' }, () => {});
    definition.build(scope, parent, null);
    send(1);
    send(2);
    scope.dispose();
    let settled = false;
    const closing = Effect.runPromise(scope.settlement.wait()).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await closing;
    expect(finalized.sort((a, b) => a - b)).toEqual([1, 2]);
  });
}

it('joins commands started through the task builder', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tasks = defineTasks({ init: (_props: Props) => ({}) }).tasks({
    Work: {
      policy: 'replace',
      run: () => Effect.never.pipe(Effect.ensuring(Effect.promise(() => gate))),
    },
  });
  let start!: () => void;
  const definition: View<Props, never> = tasks.view(
    compiled((scope) => {
      start = () => tasks.controls(scope.send).run('Work');
    }),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  definition.build(scope, parent, null);
  start();
  scope.dispose();
  let settled = false;
  const closing = Effect.runPromise(scope.settlement.wait()).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await closing;
});

it('finishes settlement when a program close throws or fails, while reporting it', async () => {
  for (const mode of ['throw', 'fail'] as const) {
    const error = new Error(mode);
    const report = vi.fn();
    const definition = programView({
      create: () => ({
        model: () => 0,
        send: () => {},
        subscribe: () => () => {},
        dispose: () => {},
        close: () => {
          if (mode === 'throw') throw error;
          return Effect.fail(error);
        },
      }),
      receive: () => {},
      view: compiled<number, never>(() => {}),
    });
    const scope = new Scope<unknown, never>(undefined, () => {}, report);
    definition.build(scope, parent, null);
    scope.dispose();
    await Effect.runPromise(scope.settlement.wait());
    expect(report).toHaveBeenCalledTimes(1);
  }
});

it('closes model-owner sources and their dependencies after the last command finalizer', async () => {
  const { modelOwner } = await import('./owner.js');
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const definition = programView({
    create: () => {
      const owner = modelOwner({});
      owner.own({
        dispose: () => {
          order.push('dependency');
        },
      });
      owner.run(
        commandSlot('work'),
        Effect.never.pipe(
          Effect.ensuring(
            Effect.promise(async () => {
              await gate;
              order.push('finalizer');
            }),
          ),
        ),
        'replace',
      );
      return owner.source;
    },
    receive: () => {},
    view: compiled<{}, never>(() => {}),
  });
  const scope = new Scope<unknown, never>(undefined, () => {});
  definition.build(scope, parent, null);
  scope.dispose();
  expect(order).toEqual([]);
  release();
  await Effect.runPromise(scope.settlement.wait());
  expect(order).toEqual(['finalizer', 'dependency']);
});

it('releases a program when its subscription reentrantly disposes the parent', async () => {
  const dispose = vi.fn();
  const unsubscribe = vi.fn();
  const build = vi.fn();
  const report = vi.fn();
  const scope = new Scope<unknown, never>(undefined, () => {}, report);
  const definition = programView({
    create: () => ({
      model: () => 0,
      send: () => {},
      dispose,
      subscribe: () => {
        scope.dispose();
        return unsubscribe;
      },
    }),
    receive: () => {},
    view: compiled<number, never>(build),
  });
  definition.build(scope, parent, null);
  await Effect.runPromise(scope.settlement.wait());
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(build).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

it('releases a source acquired during parent disposal', async () => {
  const dispose = vi.fn();
  const scope = new Scope<unknown, never>(undefined, () => {});
  const definition = programView({
    create: () => {
      scope.dispose();
      return { model: () => 0, send: () => {}, dispose, subscribe: () => () => {} };
    },
    receive: () => {},
    view: compiled<number, never>(() => {
      throw new Error('Must not mount');
    }),
  });
  definition.build(scope, parent, null);
  await Effect.runPromise(scope.settlement.wait());
  expect(dispose).toHaveBeenCalledTimes(1);
});
