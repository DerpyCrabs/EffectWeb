import { Cause, Deferred, Effect, Exit, Fiber, Scope as EffectScope } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { expect, it } from 'vitest';
import { createModelOwner } from './owner.js';
import { makeUiRuntime } from './runtime.js';

const initialRead = () => ({
  read: AsyncResult.initial() as AsyncResult.AsyncResult<string, unknown>,
});

it('releases a task acquisition before the task owner finishes closing', async () => {
  let released = false;
  let releasedAtTaskClose = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime<EffectScope.Scope>();
        const owner = createModelOwner(initialRead(), { runtime });
        owner.task(
          'read',
          Effect.acquireRelease(Effect.succeed('value'), () =>
            Effect.sync(() => {
              released = true;
            }),
          ),
          'replace',
        );
        yield* owner.awaitIdle();
        yield* owner.close();
        releasedAtTaskClose = released;
      }),
    ),
  );
  expect(released).toBe(true);
  expect(releasedAtTaskClose).toBe(true);
});

it.each(['complete', 'failure', 'cancel', 'replace', 'close'] as const)(
  'joins asynchronous task resource release after %s without an explicit runtime',
  async (action) => {
    const release = Deferred.makeUnsafe<void>();
    let releasing: Exit.Exit<unknown, unknown> | undefined;
    let releases = 0;
    let attempts = 0;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makeUiRuntime();
          const owner = createModelOwner(initialRead(), { runtime });
          const read = () =>
            owner.task(
              'read',
              Effect.gen(function* () {
                if (++attempts > 1) return 'replacement';
                yield* Effect.acquireRelease(Effect.void, (_, exit) =>
                  Effect.gen(function* () {
                    releasing = exit;
                    yield* Deferred.await(release);
                    releases++;
                  }),
                );
                if (action === 'complete') return 'value';
                if (action === 'failure') return yield* Effect.fail('load failed');
                return yield* Effect.never;
              }),
              'replace',
            );
          void read();
          if (action === 'cancel') owner.cancel('read');
          if (action === 'replace') void read();
          const closing = Effect.runFork(owner.close());
          try {
            expect(releasing).toBeDefined();
            expect(closing.pollUnsafe()).toBeUndefined();
            expect(releases).toBe(0);
            if (action === 'complete') expect(releasing?._tag).toBe('Success');
            else {
              expect(releasing?._tag).toBe('Failure');
              if (releasing && Exit.isFailure(releasing)) {
                if (action === 'failure') expect(Cause.squash(releasing.cause)).toBe('load failed');
                else expect(Cause.hasInterruptsOnly(releasing.cause)).toBe(true);
              }
            }
          } finally {
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(closing);
          }
          expect(releases).toBe(1);
        }),
      ),
    );
  },
);
