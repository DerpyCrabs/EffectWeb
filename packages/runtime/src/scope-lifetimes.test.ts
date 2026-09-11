import { Cause, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { expect, it, vi } from 'vitest';
import { mount } from './render.js';
import { query } from './query.js';
import { makeQueryCache, scopedQueryCache } from './cache.js';
import { queryResource } from './session.js';
import { domMount, startMount } from './mount.js';

it('passes view setup failure to its resource finalizers', async () => {
  let released: Exit.Exit<unknown, unknown> | undefined;
  const setup = Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, (_, exit) =>
      Effect.sync(() => {
        released = exit;
      }),
    );
    return yield* Effect.fail('setup failed');
  });
  const result = await Effect.runPromiseExit(
    Effect.scoped(mount({} as Node, setup, { model: () => 0, subscribe: () => () => {} })),
  );
  expect(Exit.isFailure(result)).toBe(true);
  expect(released?._tag).toBe('Failure');
  if (released && Exit.isFailure(released))
    expect(Cause.squash(released.cause)).toBe('setup failed');
});

it('releases scoped query acquisition when the cache closes before its parent scope', async () => {
  let released = false;
  const definition = query({
    name: 'scoped-query-audit',
    load: (_args: string) =>
      Effect.acquireRelease(Effect.succeed(1), () =>
        Effect.sync(() => {
          released = true;
        }),
      ),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* scopedQueryCache<Scope.Scope>();
        yield* cache.prefetch(definition, 'one');
        expect(released).toBe(false);
        yield* cache.close();
        expect(released).toBe(true);
      }),
    ),
  );
});

it('preserves setup interruption and joins asynchronous resource release', async () => {
  const acquired = Deferred.makeUnsafe<void>();
  const releaseStarted = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  let released: Exit.Exit<unknown, unknown> | undefined;
  const setup = Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, (_, exit) =>
      Effect.gen(function* () {
        released = exit;
        yield* Deferred.succeed(releaseStarted, undefined);
        yield* Deferred.await(release);
      }),
    );
    yield* Deferred.succeed(acquired, undefined);
    return yield* Effect.never;
  });
  const application = Effect.runFork(
    Effect.scoped(mount({} as Node, setup, { model: () => 0, subscribe: () => () => {} })),
  );
  await Effect.runPromise(Deferred.await(acquired));
  const interrupt = Effect.runFork(Fiber.interrupt(application));
  await Effect.runPromise(Deferred.await(releaseStarted));
  expect(interrupt.pollUnsafe()).toBeUndefined();
  expect(released?._tag).toBe('Failure');
  if (released && Exit.isFailure(released))
    expect(Cause.hasInterruptsOnly(released.cause)).toBe(true);
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await Effect.runPromise(Fiber.join(interrupt));
});

it('preserves a failed DOM acquisition exit while joining its resource release', async () => {
  const release = Deferred.makeUnsafe<void>();
  let released: Exit.Exit<unknown, unknown> | undefined;
  const reports: unknown[] = [];
  const lifetime = startMount(
    {} as HTMLElement,
    domMount((_element: HTMLElement) =>
      Effect.acquireRelease(Effect.void, (_, exit) =>
        Effect.gen(function* () {
          released = exit;
          yield* Deferred.await(release);
        }),
      ).pipe(Effect.andThen(Effect.fail('DOM acquisition failed'))),
    ),
    (cause) => reports.push(cause),
  );
  const closing = Effect.runFork(lifetime.close());
  expect(closing.pollUnsafe()).toBeUndefined();
  expect(released?._tag).toBe('Failure');
  if (released && Exit.isFailure(released))
    expect(Cause.squash(released.cause)).toBe('DOM acquisition failed');
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await Effect.runPromise(Fiber.join(closing));
  expect(reports).toHaveLength(1);
});

it.each(['close', 'remove', 'reset', 'refresh', 'cancel', 'unused', 'evict'] as const)(
  'joins asynchronous query resources after %s, including resources of replaced or evicted entries',
  async (action) => {
    if (action === 'evict') vi.useFakeTimers();
    const cache = makeQueryCache({
      retention: 100,
      unused: action === 'unused' ? 'cancel' : 'retain',
    });
    const release = Deferred.makeUnsafe<void>();
    const releasing: number[] = [];
    const released: number[] = [];
    let loads = 0;
    const definition = query({
      name: `scoped-${action}`,
      load: () =>
        Effect.gen(function* () {
          const id = yield* Effect.acquireRelease(
            Effect.sync(() => ++loads),
            (id) =>
              Effect.gen(function* () {
                releasing.push(id);
                yield* Deferred.await(release);
                released.push(id);
              }),
          );
          if (action === 'cancel' || action === 'unused') return yield* Effect.never;
          return id;
        }),
    });
    const observer = queryResource({ cache }, definition);
    try {
      observer.select(true);
      expect(releasing).toEqual([]);
      if (action === 'remove') cache.removeQuery(definition, true);
      else if (action === 'reset') cache.resetResources();
      else if (action === 'refresh') cache.invalidateQuery(definition, true);
      else if (action === 'cancel') cache.cancelQuery(definition, true);
      else if (action === 'unused' || action === 'evict') {
        observer.dispose();
        if (action === 'evict') await vi.advanceTimersByTimeAsync(1_000);
      }
      if (action !== 'close') expect(releasing).toContain(1);
      const closing = Effect.runFork(cache.close());
      expect(closing.pollUnsafe()).toBeUndefined();
      expect(released).toEqual([]);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(closing));
      expect(released).toContain(1);
      expect(new Set(released).size).toBe(released.length);
      expect(released).toHaveLength(loads);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      observer.dispose();
      await Effect.runPromise(cache.close());
      if (action === 'evict') vi.useRealTimers();
    }
  },
);

it('joins load finalizers before releasing query resources on cancellation', async () => {
  const loadFinalizer = Deferred.makeUnsafe<void>();
  const resourceFinalizer = Deferred.makeUnsafe<void>();
  const order: string[] = [];
  const cache = makeQueryCache();
  const definition = query({
    name: 'query-release-order',
    load: () =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.gen(function* () {
            order.push('resource release started');
            yield* Deferred.await(resourceFinalizer);
            order.push('resource released');
          }),
        );
        return yield* Effect.never.pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              order.push('load finalizer started');
              yield* Deferred.await(loadFinalizer);
              order.push('load finalized');
            }),
          ),
        );
      }),
  });
  const observer = queryResource({ cache }, definition);
  observer.select(true);
  cache.cancelQuery(definition, true);
  const closing = Effect.runFork(cache.close());
  expect(order).toEqual(['load finalizer started']);
  expect(closing.pollUnsafe()).toBeUndefined();
  await Effect.runPromise(Deferred.succeed(loadFinalizer, undefined));
  expect(order).toEqual(['load finalizer started', 'load finalized', 'resource release started']);
  expect(closing.pollUnsafe()).toBeUndefined();
  await Effect.runPromise(Deferred.succeed(resourceFinalizer, undefined));
  await Effect.runPromise(Fiber.join(closing));
  expect(order.at(-1)).toBe('resource released');
  observer.dispose();
});

it('joins a late query acquisition and its asynchronous release after cancellation', async () => {
  const acquisition = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  let releasing = false;
  let released = false;
  const cache = makeQueryCache();
  const definition = query({
    name: 'late-query-acquisition',
    load: () =>
      Effect.acquireRelease(Deferred.await(acquisition), () =>
        Effect.gen(function* () {
          releasing = true;
          yield* Deferred.await(release);
          released = true;
        }),
      ),
  });
  const observer = queryResource({ cache }, definition);
  observer.select(true);
  cache.cancelQuery(definition, true);
  const closing = Effect.runFork(cache.close());
  expect(releasing).toBe(false);
  expect(closing.pollUnsafe()).toBeUndefined();
  await Effect.runPromise(Deferred.succeed(acquisition, undefined));
  expect(releasing).toBe(true);
  expect(closing.pollUnsafe()).toBeUndefined();
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await Effect.runPromise(Fiber.join(closing));
  expect(released).toBe(true);
  observer.dispose();
});

it('releases failed query resources with the original failure before publishing that failure', async () => {
  const release = Deferred.makeUnsafe<void>();
  let released: Exit.Exit<unknown, unknown> | undefined;
  const cache = makeQueryCache();
  const definition = query({
    name: 'query-failure-exit',
    load: () =>
      Effect.acquireRelease(Effect.void, (_, exit) =>
        Effect.gen(function* () {
          released = exit;
          yield* Deferred.await(release);
        }),
      ).pipe(Effect.andThen(Effect.fail('query failed'))),
  });
  const load = Effect.runFork(cache.prefetch(definition, true));
  expect(released?._tag).toBe('Failure');
  if (released && Exit.isFailure(released))
    expect(Cause.squash(released.cause)).toBe('query failed');
  expect(load.pollUnsafe()).toBeUndefined();
  await Effect.runPromise(Deferred.succeed(release, undefined));
  const result = await Effect.runPromise(Fiber.await(load));
  expect(Exit.isFailure(result)).toBe(true);
  if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBe('query failed');
  await Effect.runPromise(cache.close());
});
