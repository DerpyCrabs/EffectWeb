// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { composeMounts, domBinding, domMount, prepareMount } from './mount.js';
import { uiRuntime } from './runtime.js';

it('joins gated finalizers of both replaced and current bindings', async () => {
  const firstGate = Deferred.makeUnsafe<void>();
  const secondGate = Deferred.makeUnsafe<void>();
  const firstClosing = Deferred.makeUnsafe<void>();
  const secondClosing = Deferred.makeUnsafe<void>();
  const scoped = (gate: Deferred.Deferred<void>, closing: Deferred.Deferred<void>) =>
    domMount(() =>
      Effect.acquireRelease(Effect.void, () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(closing, undefined);
          yield* Deferred.await(gate);
        }),
      ),
    );
  const first = scoped(firstGate, firstClosing);
  const second = scoped(secondGate, secondClosing);
  const lifetime = prepareMount(document.createElement('div'), composeMounts([first]));
  lifetime.start();
  lifetime.update(composeMounts([second]));
  await Effect.runPromise(Deferred.await(firstClosing));
  let closed = false;
  const closing = Effect.runFork(
    lifetime.close().pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          closed = true;
        }),
      ),
    ),
  );
  await Effect.runPromise(Deferred.await(secondClosing));
  expect(closed).toBe(false);
  Deferred.doneUnsafe(secondGate, Effect.void);
  await Promise.resolve();
  expect(closed).toBe(false);
  Deferred.doneUnsafe(firstGate, Effect.void);
  await Effect.runPromise(Fiber.join(closing));
  expect(closed).toBe(true);
});

it('uses the application runtime and reports asynchronous child errors to its owner', async () => {
  const label = Context.Reference<string>('composition-service', { defaultValue: () => 'missing' });
  const runtime = uiRuntime(Context.make(label, 'application'));
  const failure = new Error('child failed');
  const errors: unknown[] = [];
  const reported = Deferred.makeUnsafe<void>();
  let observed = '';
  const lifetime = prepareMount(
    document.createElement('div'),
    composeMounts([
      domMount(() =>
        Effect.gen(function* () {
          observed = yield* label;
          return yield* Effect.die(failure);
        }),
      ),
    ]),
    (error) => {
      errors.push(error);
      Deferred.doneUnsafe(reported, Effect.void);
    },
    runtime,
  );
  lifetime.start();
  await Effect.runPromise(Deferred.await(reported));
  await Effect.runPromise(lifetime.close());
  expect(observed).toBe('application');
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain('child failed');
});

it('does not starve other cleanup when a disposer throws', async () => {
  const released: string[] = [];
  const errors: unknown[] = [];
  const lifetime = prepareMount(
    document.createElement('div'),
    composeMounts([
      domMount(() => () => {
        released.push('first');
      }),
      domMount(() => () => {
        released.push('second');
        throw new Error('cleanup failed');
      }),
    ]),
    (error) => errors.push(error),
  );
  lifetime.start();
  await Effect.runPromise(lifetime.close());
  expect(released).toEqual(['second', 'first']);
  expect(errors).toHaveLength(1);
});

it('reconciles a replacement published during setup and preserves unrelated bindings', async () => {
  const events: string[] = [];
  const stable = domBinding(1, (_element: Element, read: () => number) => ({
    update: () => events.push(`stable:${read()}`),
    dispose: () => events.push('stable:close'),
  }));
  const second = domMount(() => {
    events.push('second');
    return () => {
      events.push('second:close');
    };
  });
  const first = domMount(() => {
    events.push('first');
    lifetime.update(composeMounts([stable, second]));
    return () => {
      events.push('first:close');
    };
  });
  const lifetime = prepareMount(document.createElement('div'), composeMounts([stable, first]));
  lifetime.start();
  expect(events).toEqual(['first', 'stable:1', 'first:close', 'second']);
  await Effect.runPromise(lifetime.close());
  expect(events.slice(-2)).toEqual(['second:close', 'stable:close']);
});

it('closes all nested bindings when a child synchronously unmounts its owner during acquisition', async () => {
  const released: string[] = [];
  const first = domMount(() => () => {
    released.push('first');
  });
  const second = domMount(() => {
    lifetime.dispose();
    return () => {
      released.push('second');
    };
  });
  const lifetime = prepareMount(
    document.createElement('div'),
    composeMounts([composeMounts([first, second])]),
  );
  lifetime.start();
  await Effect.runPromise(lifetime.close());
  expect(released).toEqual(['first', 'second']);
});

it('does not reconcile stale later slots after an update publishes a newer group', async () => {
  const events: string[] = [];
  let redirected = false;
  const stable = domMount(() => {
    events.push('stable');
    return () => {
      events.push('stable:close');
    };
  });
  const obsolete = domMount(() => {
    events.push('obsolete');
  });
  const update = (_element: Element, read: () => boolean) => ({
    update: () => {
      if (read() && !redirected) {
        redirected = true;
        lifetime.update(composeMounts([domBinding(false, update), stable]));
      }
    },
    dispose: () => {},
  });
  const lifetime = prepareMount(
    document.createElement('div'),
    composeMounts([domBinding(false, update), stable]),
  );
  lifetime.start();
  lifetime.update(composeMounts([domBinding(true, update), obsolete]));
  expect(events).toEqual(['stable']);
  await Effect.runPromise(lifetime.close());
  expect(events).toEqual(['stable', 'stable:close']);
});
