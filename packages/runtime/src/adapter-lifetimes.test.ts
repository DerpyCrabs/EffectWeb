import { Cause, Deferred, Effect, Exit, Fiber, Scope as EffectScope } from 'effect';
import { expect, it } from 'vitest';
import { defineTasks } from './tasks.js';
import { makeUiRuntime } from './runtime.js';
import { compiled, Scope } from './dom.js';
import {
  resourceComponent,
  type ResourceModel,
  type ResourceMessage,
  available,
} from './resource.js';
import { Settlement } from './settlement.js';
import { keyedTasks } from './keyed-tasks.js';
import { makeModelOwner } from './owner.js';

it('releases a task acquisition before the task owner finishes closing', async () => {
  let released = false;
  let releasedAtTaskClose = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime<EffectScope.Scope>();
        const tasks = defineTasks({ init: () => ({}), runtime }).tasks({
          read: {
            policy: 'replace',
            run: () =>
              Effect.acquireRelease(Effect.succeed('value'), () =>
                Effect.sync(() => {
                  released = true;
                }),
              ),
          },
        });
        const source = tasks.create(undefined);
        tasks.controls(source.send).run('read');
        yield* source.awaitIdle();
        yield* source.close();
        releasedAtTaskClose = released;
      }),
    ),
  );
  expect(released).toBe(true);
  expect(releasedAtTaskClose).toBe(true);
});

it('joins resource load acquisitions at component close', async () => {
  let released = false;
  let releasedAtClose = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime<EffectScope.Scope>();
        const settlement = new Settlement();
        const root = new Scope<{}, never>({}, () => {}, undefined, settlement);
        let child!: Scope<ResourceModel<{}, string, never>, ResourceMessage>;
        const resource = resourceComponent<{}, string, never, EffectScope.Scope>({
          runtime,
          request: () => ({
            key: 'read',
            load: () =>
              Effect.acquireRelease(Effect.succeed('value'), () =>
                Effect.sync(() => {
                  released = true;
                }),
              ),
          }),
          view: compiled((scope) => {
            child = scope;
          }),
        });
        resource.build(root, {} as Node, null);
        yield* Effect.promise(() => expect.poll(() => available(child.value.result)).toBe('value'));
        root.dispose();
        yield* settlement.wait();
        releasedAtClose = released;
      }),
    ),
  );
  expect(released).toBe(true);
  expect(releasedAtClose).toBe(true);
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
          const tasks = defineTasks({ init: () => ({}) }).tasks({
            read: {
              policy: 'replace',
              run: () =>
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
            },
          });
          const source = tasks.create(undefined, runtime);
          const controls = tasks.controls(source.send);
          controls.run('read');
          if (action === 'cancel') controls.cancel('read');
          if (action === 'replace') controls.run('read');
          const closing = Effect.runFork(source.close());
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

it('joins pending resource cleanup through the ambient component runtime', async () => {
  const release = Deferred.makeUnsafe<void>();
  let releasing = false;
  let released = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime();
        const settlement = new Settlement(runtime);
        const root = new Scope({}, () => {}, undefined, settlement);
        const resource = resourceComponent({
          request: () => ({
            key: 'read',
            load: () =>
              Effect.acquireRelease(Effect.void, () =>
                Effect.gen(function* () {
                  releasing = true;
                  yield* Deferred.await(release);
                  released = true;
                }),
              ).pipe(Effect.andThen(Effect.never)),
          }),
          view: compiled(() => {}),
        });
        resource.build(root, {} as Node, null);
        root.dispose();
        const closing = Effect.runFork(settlement.wait());
        try {
          expect(releasing).toBe(true);
          expect(released).toBe(false);
          expect(closing.pollUnsafe()).toBeUndefined();
        } finally {
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(closing);
        }
        expect(released).toBe(true);
      }),
    ),
  );
});

it.each(['success', 'failure', 'cancel'] as const)(
  'keyed task %s closes its resources before publishing an outcome or finishing drain',
  async (action) => {
    const release = Deferred.makeUnsafe<void>();
    let releasing: Exit.Exit<unknown, unknown> | undefined;
    let releases = 0;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makeUiRuntime<EffectScope.Scope>();
          const owner = yield* makeModelOwner({});
          const tasks = keyedTasks(
            owner,
            {
              name: 'owned-keyed-load',
              policy: 'replace',
              run: (_key: string, _input: number) =>
                Effect.gen(function* () {
                  yield* Effect.acquireRelease(Effect.void, (_, exit) =>
                    Effect.gen(function* () {
                      releasing = exit;
                      yield* Deferred.await(release);
                      releases++;
                    }),
                  );
                  if (action === 'success') return 'value';
                  if (action === 'failure') return yield* Effect.fail('keyed load failed');
                  return yield* Effect.never;
                }),
            },
            runtime,
          );
          const handle = tasks.submit('one', 1);
          if (action === 'cancel') tasks.cancel('one');
          const outcome = Effect.runFork(handle.outcome);
          const closing = Effect.runFork(tasks.drain());
          try {
            expect(releasing).toBeDefined();
            expect(outcome.pollUnsafe()).toBeUndefined();
            expect(closing.pollUnsafe()).toBeUndefined();
            expect(releases).toBe(0);
            if (action === 'success') expect(releasing?._tag).toBe('Success');
            else {
              expect(releasing?._tag).toBe('Failure');
              if (releasing && Exit.isFailure(releasing)) {
                if (action === 'failure')
                  expect(Cause.squash(releasing.cause)).toBe('keyed load failed');
                else expect(Cause.hasInterruptsOnly(releasing.cause)).toBe(true);
              }
            }
          } finally {
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(closing);
          }
          expect(releases).toBe(1);
          const result = yield* Fiber.join(outcome);
          expect(result._tag).toBe(
            action === 'success' ? 'Success' : action === 'failure' ? 'Failure' : 'Cancelled',
          );
        }),
      ),
    );
  },
);
