import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { component, controllerView, ownerOf, programView } from './component.js';
import { attach, compiled, Scope, type View } from './dom.js';
import { domMount } from './mount.js';
import { program, type Send } from './program.js';
import { modelOwner } from './owner.js';

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
        ? component(
            { init: (_props: Props) => ({ count: 0 }), update: (model: Model) => ({ model }) },
            inner,
          )
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
    const key = 'work';
    let send!: Send<number>;
    const inner = compiled<Model, number>((scope) => {
      send = scope.send;
    });
    const update = (model: Model, count: number) => ({
      model: { ...model, count },
      commands: [
        {
          key,
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
        ? component({ init: (_props: Props) => ({ count: 0 }), update }, inner)
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

it('joins work started through a component owner', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let start!: () => void;
  const definition: View<Props, never> = component(
    { init: (_props: Props) => ({}) },
    compiled((scope) => {
      start = () =>
        void ownerOf(scope.send).run(
          'Work',
          Effect.never.pipe(Effect.ensuring(Effect.promise(() => gate))),
          'replace',
        );
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
        'work',
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

it('captures imperative state before a program view disposes its child on unmount', async () => {
  const events: string[] = [];
  const definition = programView<Props, Model, never>({
    create: (props) => {
      const source = program<Model, never>({
        initial: { props, count: 0 },
        update: (model) => ({ model }),
      });
      return {
        ...source,
        close: () =>
          Effect.sync(() => {
            events.push('close');
            source.dispose();
          }),
      };
    },
    receive: () => {},
    beforeDispose: (source) => {
      events.push(`capture:${source.model().props.id}`);
    },
    view: compiled((scope) => {
      scope.cleanups.push(() => events.push('child'));
    }),
  });
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  definition.build(scope, parent, null);
  scope.dispose();
  await Effect.runPromise(scope.settlement.wait());
  expect(events).toEqual(['capture:a', 'child', 'close']);
});

it('renders controller actions as model.actions without storing them in the model', () => {
  const seen: Array<{ count: number; props: Props }> = [];
  let owner!: ReturnType<typeof modelOwner<{ count: number }>>;
  const definition = controllerView(
    {
      controller: (props: Props) => {
        owner = modelOwner({ count: 0 });
        return {
          source: owner.source,
          increment: () => owner.patch({ count: owner.read().count + 1 }),
          dispose: owner.dispose,
          receive: (next) => seen.push({ count: owner.read().count, props: next }),
          ...(props.id ? {} : {}),
        };
      },
    },
    compiled((scope) => {
      const model = scope.value;
      scope.jobs.push(() => {
        const next = scope.value;
        seen.push({
          count: next.count,
          props: { id: `render:${String(next.actions.increment === model.actions.increment)}` },
        });
      });
      model.actions.increment();
    }),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  definition.build(scope, parent, null);
  for (const job of scope.jobs) job();
  expect(owner.read()).toEqual({ count: 1 });
  expect(Object.keys(owner.source.model())).toEqual(['count']);
  expect(seen).toContainEqual({ count: 1, props: { id: 'a' } });
  expect(seen).toContainEqual({ count: 1, props: { id: 'render:true' } });
  scope.dispose();
  expect(owner.disposed).toBe(true);
});

it('does not require receive from a controller view', () => {
  const owner = modelOwner({ count: 0 });
  const definition = controllerView(
    { controller: () => ({ source: owner.source, dispose: owner.dispose }) },
    compiled<{ count: number }, never>(() => {}),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  definition.build(scope, parent, null);
  for (const job of scope.jobs) job();
  scope.dispose();
  expect(owner.disposed).toBe(true);
});

it("joins a model owner's async cleanup when the controller hands over owner.dispose", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finalized = vi.fn();
  const definition = controllerView(
    {
      controller: (_props: Props) => {
        const owner = modelOwner({ count: 0 });
        owner.run(
          'save',
          Effect.never.pipe(
            Effect.ensuring(
              Effect.promise(() => gate).pipe(Effect.andThen(Effect.sync(finalized))),
            ),
          ),
          'replace',
        );
        // No `close` listed: `dispose: owner.dispose` hands over the owner's whole teardown.
        return { source: owner.source, dispose: owner.dispose };
      },
    },
    compiled<{ count: number }, never>(() => {}),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  definition.build(scope, parent, null);
  scope.dispose();
  let settled = false;
  const closing = Effect.runPromise(scope.settlement.wait()).then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await closing;
  expect(finalized).toHaveBeenCalledOnce();
});

it('passes everything a controller returns except its lifecycle members as actions', () => {
  let rendered!: object;
  const owner = modelOwner({ count: 0 });
  const definition = controllerView(
    {
      controller: (_props: Props) => ({
        source: owner.source,
        increment: () => owner.patch({ count: owner.read().count + 1 }),
        label: 'not a function',
        receive: () => {},
        beforeDispose: () => {},
        dispose: owner.dispose,
      }),
    },
    compiled((scope) => {
      rendered = scope.value;
    }),
  );
  const scope = new Scope<Props, never>({ id: 'a' }, () => {});
  definition.build(scope, parent, null);
  expect(Object.keys((rendered as { actions: object }).actions)).toEqual(['increment', 'label']);
  scope.dispose();
});

it('a message component gets model.props from the runtime and receives new props in it', () => {
  const received: string[] = [];
  let seen!: { props: Props; count: number };
  let send!: (message: 'inc') => void;
  const Counter = component<Props, { count: number }, 'inc'>(
    {
      init: () => ({ count: 0 }),
      receive: (model, previous) => {
        received.push(`${previous.id}->${model.props.id}`);
        return { model: { ...model, count: 0 } };
      },
      update: (model) => ({ model: { ...model, count: model.count + 1 } }),
    },
    compiled((scope) => {
      send = scope.send;
      seen = scope.value as { props: Props; count: number };
      scope.jobs.push(() => {
        seen = scope.value as { props: Props; count: number };
      });
    }),
  );
  const first = { id: 'a' };
  const scope = new Scope<Props, never>(first, () => {});
  Counter.build(scope, parent, null);
  expect(seen).toEqual({ props: { id: 'a' }, count: 0 });
  expect(received).toEqual([]);
  send('inc');
  expect(seen.count).toBe(1);
  // The same props object: receive is not called and the state is kept.
  scope.set(first);
  for (const job of scope.jobs) job();
  expect(received).toEqual([]);
  expect(seen.count).toBe(1);
  scope.set({ id: 'b' });
  for (const job of scope.jobs) job();
  expect(received).toEqual(['a->b']);
  expect(seen).toEqual({ props: { id: 'b' }, count: 0 });
  scope.dispose();
});
