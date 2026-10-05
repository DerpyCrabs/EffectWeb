import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { expect, it } from 'vitest';
import { makeMount } from './render.js';
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
    Effect.scoped(makeMount({} as Node, setup, { model: () => 0, subscribe: () => () => {} })),
  );
  expect(Exit.isFailure(result)).toBe(true);
  expect(released?._tag).toBe('Failure');
  if (released && Exit.isFailure(released))
    expect(Cause.squash(released.cause)).toBe('setup failed');
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
    Effect.scoped(makeMount({} as Node, setup, { model: () => 0, subscribe: () => () => {} })),
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
