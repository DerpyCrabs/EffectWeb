import { Effect, Cause, Exit, Fiber } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { modelOwner, type OwnedRun } from './owner.js';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { controlledEffect } from './testing.js';

const observe = <A, E>(run: OwnedRun<A, E>) => Effect.runPromise(run.await);
/** Cancelled, replaced, dropped, discarded and disposed runs settle as interruptions. */
const interrupted = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
describe('run completion', () => {
  it('starts immediately and observes the same value repeatedly without restarting', async () => {
    const owner = modelOwner({});
    const work = vi.fn(() => 42);
    const result = owner.run('save', Effect.sync(work), 'queue');
    expect(work).toHaveBeenCalledOnce();
    expect(await observe(result)).toEqual(Exit.succeed(42));
    expect(await observe(result)).toEqual(Exit.succeed(42));
    expect(work).toHaveBeenCalledOnce();
    owner.dispose();
  });
  it('reports failure once while returning its cause as data', async () => {
    const report = vi.fn();
    const owner = modelOwner({}, { onDefect: report });
    const result = await observe(owner.run('fail', Effect.fail('bad'), 'queue'));
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(Cause.squash(result.cause)).toBe('bad');
    expect(report).toHaveBeenCalledOnce();
    owner.dispose();
  });
  it('settles drop, replacement, pending supersession, cancellation and disposal as interruptions', async () => {
    const owner = modelOwner({});
    const first = owner.run(['write', 1], Effect.never, 'queue');
    const dropped = owner.run(['write', 1], Effect.void, 'drop');
    expect(await observe(dropped)).toSatisfy(interrupted);
    const queued = owner.run(['write', 1], Effect.void, 'queue');
    const latest = owner.run(['write', 1], Effect.never, 'latest-queued');
    expect(await observe(queued)).toSatisfy(interrupted);
    const replacement = owner.run(['write', 1], Effect.never, 'replace');
    expect(await observe(first)).toSatisfy(interrupted);
    expect(await observe(latest)).toSatisfy(interrupted);
    owner.cancel(['write', 1]);
    expect(await observe(replacement)).toSatisfy(interrupted);
    const active = owner.run('close', Effect.never, 'queue');
    const pending = owner.run('close', Effect.void, 'queue');
    await Effect.runPromise(owner.close());
    expect(await observe(active)).toSatisfy(interrupted);
    expect(await observe(pending)).toSatisfy(interrupted);
    expect(await observe(owner.run('late', Effect.void, 'queue'))).toSatisfy(interrupted);
  });
  it('waits for finalizers and does not cancel work when the observer is interrupted', async () => {
    const owner = modelOwner({});
    const finalizer = controlledEffect<void>();
    const result = owner.run('work', Effect.never.pipe(Effect.ensuring(finalizer.effect)), 'queue');
    owner.cancel('work');
    let settled = false;
    const completion = observe(result).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finalizer.succeed(undefined);
    expect(await completion).toSatisfy(interrupted);
    owner.dispose();
  });
  it('observes tasks; a task shares its key with run', async () => {
    const owner = modelOwner<{ save: AsyncResult.AsyncResult<number, never> }>({
      save: AsyncResult.initial(),
    });
    const manual = owner.run('save', Effect.never, 'replace');
    expect(await observe(owner.task('save', Effect.succeed(7), 'replace'))).toEqual(
      Exit.succeed(7),
    );
    expect(await observe(manual)).toSatisfy(interrupted);
    owner.dispose();
  });
  it('uses structural keys without scalar, type or delimiter collisions', async () => {
    const owner = modelOwner({});
    const keys = ['', 0, '0', ['0'], [0], ['a:b', 'c'], ['a', 'b:c']] as const;
    const settled = keys.map(() => false);
    keys.forEach((key, index) => {
      void observe(owner.run(key, Effect.never, 'drop')).then(
        () => {
          settled[index] = true;
        },
        () => {},
      );
    });
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    owner.cancel(['a:b', 'c']);
    await Effect.runPromise(owner.awaitIdle(['a:b', 'c']));
    await flush();
    expect(settled).toEqual([false, false, false, false, false, true, false]);
    owner.cancel(0);
    await Effect.runPromise(owner.awaitIdle(0));
    await flush();
    expect(settled).toEqual([false, true, false, false, false, true, false]);
    await Effect.runPromise(owner.close());
    await flush();
    expect(settled.every(Boolean)).toBe(true);
  });
});

it('settles reentrant unstarted work when disposed', async () => {
  const reentrant = modelOwner({ count: 0 });
  let queued!: ReturnType<typeof reentrant.run>;
  reentrant.source.subscribe(() => {
    queued = reentrant.run('queued', Effect.never, 'queue');
    reentrant.dispose();
  });
  reentrant.patch({ count: 1 });
  expect(await observe(queued)).toSatisfy(interrupted);
});

it('observes each queued or parallel run independently', async () => {
  const owner = modelOwner({});
  const first = controlledEffect<number>();
  const second = controlledEffect<number>();
  const a = owner.run(['queue', 1], first.effect, 'queue');
  const b = owner.run(['queue', 1], second.effect, 'queue');
  first.succeed(1);
  expect(await observe(a)).toEqual(Exit.succeed(1));
  second.succeed(2);
  expect(await observe(b)).toEqual(Exit.succeed(2));
  const third = controlledEffect<number>();
  const c = owner.run('parallel', third.effect, 'parallel');
  const d = owner.run('parallel', Effect.succeed(4), 'parallel');
  expect(await observe(d)).toEqual(Exit.succeed(4));
  third.succeed(3);
  expect(await observe(c)).toEqual(Exit.succeed(3));
  owner.dispose();
});

it('copies composite keys at admission and scopes them to one owner', async () => {
  const owner = modelOwner({});
  const other = modelOwner({});
  const key = ['row', 1];
  const a = owner.run(key, Effect.never, 'replace');
  const b = other.run(['row', 1], Effect.never, 'replace');
  key[1] = 2;
  owner.cancel(['row', 1]);
  expect(await observe(a)).toSatisfy(interrupted);
  owner.dispose();
  other.dispose();
  expect(await observe(b)).toSatisfy(interrupted);
});

it('interrupting the completion observer leaves the owned work running', async () => {
  const owner = modelOwner({});
  const request = controlledEffect<number>();
  const completion = owner.run('save', request.effect, 'replace');
  const observer = Effect.runFork(completion.await);
  await Effect.runPromise(Fiber.interrupt(observer));
  request.succeed(9);
  expect(await observe(completion)).toEqual(Exit.succeed(9));
  owner.dispose();
});

it('releases the key before resuming completion observers', async () => {
  const owner = modelOwner({});
  const request = controlledEffect<number>();
  const first = owner.run('save', request.effect, 'drop');
  const sequence = Effect.runPromise(
    Effect.gen(function* () {
      yield* first.await;
      return yield* owner.run('save', Effect.succeed(2), 'drop').await;
    }),
  );
  request.succeed(1);
  expect(await sequence).toEqual(Exit.succeed(2));
  owner.dispose();
});
