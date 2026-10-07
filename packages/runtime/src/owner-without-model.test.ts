import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';

it('an owner without a model joins work finalizers before closing its resources', async () => {
  const scope = modelOwner({});
  const calls: string[] = [];
  scope.own({ dispose: () => calls.push('resource') });
  const key = 'work';
  scope.run(
    key,
    Effect.never.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          calls.push('command');
        }),
      ),
    ),
    'drop',
  );
  await Effect.runPromise(scope.close());
  expect(calls).toEqual(['command', 'resource']);
  expect(scope.disposed).toBe(true);
});

it('an owner scoped with acquireRelease closes its resources with the surrounding scope', async () => {
  const events: string[] = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.acquireRelease(
          Effect.sync(() => modelOwner({})),
          (scope) => scope.close(),
        );
        scope.own(() => events.push('released'));
        scope.run(
          'work',
          Effect.sync(() => events.push('ran')),
          'drop',
        );
        yield* scope.awaitIdle();
        events.push('scope closing');
      }),
    ),
  );
  expect(events).toEqual(['ran', 'scope closing', 'released']);
});
