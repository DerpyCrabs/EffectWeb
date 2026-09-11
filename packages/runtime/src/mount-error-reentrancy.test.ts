import { Effect, Exit, Cause, Deferred, Fiber } from 'effect';
import { expect, it } from 'vitest';
import { domMount, prepareMount } from './mount.js';

it('claims a failed acquisition exit before a reentrant error reporter disposes it', async () => {
  let released: Exit.Exit<unknown, unknown> | undefined;
  const lifetime = prepareMount(
    {} as HTMLElement,
    domMount(() =>
      Effect.acquireRelease(Effect.void, (_, exit) =>
        Effect.sync(() => {
          released = exit;
        }),
      ).pipe(Effect.andThen(Effect.fail('acquisition failed'))),
    ),
    () => lifetime.dispose(),
  );
  lifetime.start();
  await Effect.runPromise(lifetime.close());
  expect(released?._tag).toBe('Failure');
  if (released && Exit.isFailure(released))
    expect(Cause.squash(released.cause)).toBe('acquisition failed');
});

it('joins asynchronous release once when failure reporting starts close', async () => {
  const release = Deferred.makeUnsafe<void>();
  let released: Exit.Exit<unknown, unknown> | undefined;
  let releases = 0;
  let reportedClose: Fiber.Fiber<void> | undefined;
  const lifetime = prepareMount(
    {} as HTMLElement,
    domMount(() =>
      Effect.acquireRelease(Effect.void, (_, exit) =>
        Effect.gen(function* () {
          released = exit;
          yield* Deferred.await(release);
          releases++;
        }),
      ).pipe(Effect.andThen(Effect.fail('acquisition failed'))),
    ),
    () => {
      reportedClose = Effect.runFork(lifetime.close());
    },
  );
  lifetime.start();
  const closing = Effect.runFork(lifetime.close());
  try {
    expect(released?._tag).toBe('Failure');
    if (released && Exit.isFailure(released))
      expect(Cause.squash(released.cause)).toBe('acquisition failed');
    expect(reportedClose).toBeDefined();
    expect(reportedClose!.pollUnsafe()).toBeUndefined();
    expect(closing.pollUnsafe()).toBeUndefined();
    expect(releases).toBe(0);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(closing));
    if (reportedClose) await Effect.runPromise(Fiber.join(reportedClose));
  }
  expect(releases).toBe(1);
});
