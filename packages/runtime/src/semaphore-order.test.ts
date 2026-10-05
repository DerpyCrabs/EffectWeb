import { Effect, Semaphore } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';
import { controlledEffect } from './testing.js';

it('runs limited by a semaphore start in the order they were requested, and a waiting run can be cancelled', async () => {
  const owner = modelOwner({});
  const slots = Semaphore.makeUnsafe(2);
  const started: string[] = [];
  const requests = new Map<string, ReturnType<typeof controlledEffect<void>>>();
  const start = (id: string) => {
    const request = controlledEffect<void>();
    requests.set(id, request);
    owner.run(
      ['upload', id],
      slots.withPermit(Effect.sync(() => started.push(id)).pipe(Effect.andThen(request.effect))),
      'replace',
    );
  };
  for (const id of ['a', 'b', 'c', 'd', 'e']) start(id);
  await Effect.runPromise(Effect.yieldNow);
  expect(started).toEqual(['a', 'b']);
  owner.cancel(['upload', 'c']);
  requests.get('a')!.succeed();
  await Effect.runPromise(Effect.yieldNow);
  await Effect.runPromise(Effect.yieldNow);
  expect(started).toEqual(['a', 'b', 'd']);
  requests.get('b')!.succeed();
  await Effect.runPromise(Effect.yieldNow);
  await Effect.runPromise(Effect.yieldNow);
  expect(started).toEqual(['a', 'b', 'd', 'e']);
  owner.dispose();
});
