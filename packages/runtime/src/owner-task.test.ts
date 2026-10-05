import { Cause, Effect, Exit, Option } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { expect, it, vi } from 'vitest';
import { modelOwner } from './owner.js';
import { controlledEffect } from './testing.js';

const interrupted = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
const value = <A, E>(result: AsyncResult.AsyncResult<A, E> | undefined) =>
  result && Option.getOrUndefined(AsyncResult.value(result));

it('publishes a task result across success, failure, replacement and cancellation', async () => {
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number, string>; other: number }>({
    saved: AsyncResult.initial(),
    other: 0,
  });
  const first = controlledEffect<number, string>();
  owner.task('saved', first.effect, 'replace');
  expect(owner.read().saved.waiting).toBe(true);
  first.succeed(1);
  await Effect.runPromise(owner.awaitIdle());
  expect(value(owner.read().saved)).toBe(1);
  expect(owner.read().saved.waiting).toBe(false);

  const second = controlledEffect<number, string>();
  owner.task('saved', second.effect, 'replace');
  expect(owner.read().saved.waiting).toBe(true);
  expect(value(owner.read().saved)).toBe(1);
  second.fail('offline');
  await Effect.runPromise(owner.awaitIdle());
  expect(AsyncResult.isFailure(owner.read().saved)).toBe(true);
  expect(value(owner.read().saved)).toBe(1);

  const third = controlledEffect<number, string>();
  const fourth = controlledEffect<number, string>();
  const seen: boolean[] = [];
  const stop = owner.source.subscribe((model) => seen.push(model.saved.waiting));
  owner.task('saved', third.effect, 'replace');
  owner.task('saved', fourth.effect, 'replace');
  await vi.waitFor(() => expect(fourth.pending()).toBe(1));
  expect(third.canceled()).toBe(1);
  // The replaced run never publishes a settled state between the two runs.
  expect(seen.every(Boolean)).toBe(true);
  fourth.succeed(4);
  await Effect.runPromise(owner.awaitIdle());
  expect(value(owner.read().saved)).toBe(4);
  stop();

  owner.task('saved', controlledEffect<number, string>().effect, 'replace');
  owner.cancel('saved');
  await Effect.runPromise(owner.awaitIdle());
  expect(owner.read().saved.waiting).toBe(false);
  expect(value(owner.read().saved)).toBe(4);
  owner.dispose();
});

it('stays waiting while queued work remains and keeps earlier successes', async () => {
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number, never> }>({
    saved: AsyncResult.initial(),
  });
  const first = controlledEffect<number>();
  const second = controlledEffect<number>();
  owner.task('saved', first.effect, 'queue');
  owner.task('saved', second.effect, 'queue');
  expect(owner.read().saved.waiting).toBe(true);
  first.succeed(10);
  await vi.waitFor(() => expect(second.pending()).toBe(1));
  expect(value(owner.read().saved)).toBe(10);
  expect(owner.read().saved.waiting).toBe(true);
  second.succeed(20);
  await Effect.runPromise(owner.awaitIdle());
  expect(value(owner.read().saved)).toBe(20);
  expect(owner.read().saved.waiting).toBe(false);

  const third = controlledEffect<number>();
  owner.task('saved', third.effect, 'queue');
  owner.task('saved', controlledEffect<number>().effect, 'queue');
  owner.cancel('saved');
  await Effect.runPromise(owner.awaitIdle());
  expect(owner.read().saved.waiting).toBe(false);
  expect(value(owner.read().saved)).toBe(20);
  owner.dispose();
});

it('drops a second request without touching the running result and returns outcomes', async () => {
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<string, never> }>({
    saved: AsyncResult.initial(),
  });
  const pending = controlledEffect<string>();
  const first = owner.task('saved', pending.effect, 'drop');
  const second = owner.task('saved', Effect.succeed('late'), 'drop');
  expect(await Effect.runPromise(second.await)).toSatisfy(interrupted);
  expect(owner.read().saved.waiting).toBe(true);
  pending.succeed('saved');
  expect(await Effect.runPromise(first.await)).toEqual(Exit.succeed('saved'));
  expect(value(owner.read().saved)).toBe('saved');
  owner.dispose();
});

it('writes row keys into a record and keeps rows independent', async () => {
  const owner = modelOwner<{
    sending: Partial<Record<string, AsyncResult.AsyncResult<number, string>>>;
  }>({ sending: {} });
  const a = controlledEffect<number, string>();
  const b = controlledEffect<number, string>();
  owner.task(['sending', 'a'], a.effect, 'drop');
  owner.task(['sending', 'b'], b.effect, 'drop');
  owner.task(['sending', 'a'], Effect.succeed(0), 'drop');
  expect(owner.read().sending.a?.waiting).toBe(true);
  expect(owner.read().sending.b?.waiting).toBe(true);
  a.succeed(1);
  b.fail('offline');
  await Effect.runPromise(owner.awaitIdle());
  expect(value(owner.read().sending.a)).toBe(1);
  expect(AsyncResult.isFailure(owner.read().sending.b!)).toBe(true);
  owner.dispose();
});

it('starts a task staged in a transaction on commit and settles it on rollback', async () => {
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number, never>; text: string }>({
    saved: AsyncResult.initial(),
    text: '',
  });
  expect(() =>
    owner.transaction(() => {
      owner.task('saved', Effect.succeed(1), 'drop');
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  await Effect.runPromise(owner.awaitIdle());
  expect(AsyncResult.isInitial(owner.read().saved)).toBe(true);
  expect(owner.read().saved.waiting).toBe(false);
  owner.transaction(() => {
    owner.patch({ text: 'a' });
    owner.task('saved', Effect.succeed(2), 'drop');
  });
  await Effect.runPromise(owner.awaitIdle());
  expect(value(owner.read().saved)).toBe(2);
  owner.dispose();
});

it('stops publishing after disposal', async () => {
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number, never> }>({
    saved: AsyncResult.initial(),
  });
  const pending = controlledEffect<number>();
  const outcome = owner.task('saved', pending.effect, 'drop');
  owner.dispose();
  expect(await Effect.runPromise(outcome.await)).toSatisfy(interrupted);
  expect(pending.canceled()).toBe(1);
  expect(await Effect.runPromise(owner.task('saved', Effect.succeed(1), 'drop').await)).toSatisfy(
    interrupted,
  );
  expect(owner.read().saved.waiting).toBe(true);
});

it('publishes typed failures without reporting them, and still reports defects', async () => {
  const reported: unknown[] = [];
  const owner = modelOwner<{ saved: AsyncResult.AsyncResult<number, string> }>(
    { saved: AsyncResult.initial() },
    { onDefect: (cause) => reported.push(cause) },
  );
  const failed = await Effect.runPromise(owner.task('saved', Effect.fail('offline'), 'drop').await);
  expect(failed._tag).toBe('Failure');
  expect(AsyncResult.isFailure(owner.read().saved)).toBe(true);
  expect(reported).toEqual([]);
  const died = await Effect.runPromise(owner.task('saved', Effect.die('bug'), 'drop').await);
  expect(died._tag).toBe('Failure');
  expect(reported).toHaveLength(1);
  owner.run('other', Effect.fail('unhandled'), 'drop');
  await Effect.runPromise(owner.awaitIdle());
  expect(reported).toHaveLength(2);
  owner.dispose();
});
