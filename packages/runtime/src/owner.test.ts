import { Context, Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { modelOwner } from './owner.js';
import { uiRuntime } from './runtime.js';

it('publishes one snapshot per transaction and handles reentrant edits against current state', () => {
  const owner = modelOwner({ count: 0, label: 'old' });
  const seen: number[] = [];
  owner.source.subscribe((model) => {
    seen.push(model.count);
    if (model.count === 2) owner.edit('count', (n) => n + 1);
  });
  owner.transaction(() => {
    owner.patch({ count: 1 });
    owner.transaction(() => owner.edit('count', (n) => n + 1));
    expect(owner.read().count).toBe(2);
    expect(owner.source.model().count).toBe(0);
  });
  expect(seen).toEqual([2, 3]);
  owner.patch({ count: 3 });
  expect(seen).toEqual([2, 3]);
  owner.dispose();
});

it('rolls back nested transactions and does not launch work from an aborted transaction', async () => {
  const owner = modelOwner({ count: 0 });
  const work = vi.fn();
  const seen = vi.fn();
  owner.source.subscribe(seen);
  expect(() =>
    owner.transaction(() => {
      owner.patch({ count: 1 });
      owner.run('task', Effect.sync(work));
      throw new Error('abort');
    }),
  ).toThrow('abort');
  expect(owner.read().count).toBe(0);
  expect(seen).not.toHaveBeenCalled();
  expect(work).not.toHaveBeenCalled();
  owner.transaction(() => {
    owner.patch({ count: 2 });
    try {
      owner.transaction(() => {
        owner.patch({ count: 99 });
        throw new Error('inner');
      });
    } catch {}
    expect(owner.read().count).toBe(2);
  });
  expect(seen).toHaveBeenCalledTimes(1);
  owner.dispose();
});

it('owns replace, drop and parallel work and cancels the whole named group', async () => {
  const owner = modelOwner({ count: 0 });
  const start = vi.fn(),
    stop = vi.fn();
  const work = Effect.sync(start).pipe(
    Effect.andThen(Effect.never),
    Effect.ensuring(Effect.sync(stop)),
  );
  owner.run('load', work);
  owner.run('load', work, 'drop');
  expect(start).toHaveBeenCalledTimes(1);
  owner.run('load', work, 'parallel');
  expect(start).toHaveBeenCalledTimes(2);
  owner.run('load', work);
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  expect(owner.isRunning('load')).toBe(true);
  owner.cancel('load');
  await owner.awaitIdle();
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(3));
  expect(owner.isRunning('load')).toBe(false);
  owner.dispose();
});

it('resolves task policies within a batch before executing commands and publishes before work', async () => {
  const owner = modelOwner({ count: 0 });
  const ran: number[] = [];
  owner.transaction(() => {
    owner.run(
      'same',
      Effect.sync(() => ran.push(-1)),
    );
    owner.run(
      'same',
      Effect.sync(() => ran.push(owner.read().count)),
    );
    owner.run(
      'canceled',
      Effect.sync(() => ran.push(-2)),
    );
    owner.cancel('canceled');
    owner.patch({ count: 5 });
  });
  await owner.awaitIdle();
  expect(ran).toEqual([5]);
  owner.dispose();
});

it('disposes resources, suppresses later writes and prevents work after listener-driven disposal', () => {
  const owner = modelOwner({ count: 0 });
  const dispose = vi.fn(),
    work = vi.fn();
  owner.own({ dispose });
  owner.source.subscribe(() => owner.dispose());
  owner.transaction(() => {
    owner.patch({ count: 1 });
    owner.run('work', Effect.sync(work));
  });
  owner.source.dispose();
  owner.patch({ count: 10 });
  owner.edit('count', (n) => n + 1);
  owner.run('work', Effect.sync(work));
  expect(work).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
  const late = vi.fn();
  owner.own({ dispose: late });
  expect(late).toHaveBeenCalledOnce();
});

it('provides application services and reports failures without retaining a busy slot', async () => {
  class Value extends Context.Service<Value, { count: number }>()('OwnerValue') {}
  const onDefect = vi.fn();
  const owner = modelOwner(
    { count: 0 },
    { runtime: uiRuntime(Context.make(Value, { count: 42 })), onDefect },
  );
  owner.run(
    'read',
    Effect.flatMap(Value, (value) => Effect.sync(() => owner.patch(value))),
  );
  await owner.awaitIdle();
  expect(owner.read().count).toBe(42);
  owner.run('fail', Effect.fail('offline'));
  await owner.awaitIdle();
  expect(onDefect).toHaveBeenCalledOnce();
  expect(owner.isRunning('fail')).toBe(false);
  owner.dispose();
});

it('returns synchronous transaction values without treating plain data as a Promise', () => {
  const owner = modelOwner({ count: 0 });
  // A non-callable then field is ordinary synchronous data.
  // oxlint-disable-next-line unicorn/no-thenable
  expect(owner.transaction(() => ({ then: 42 }))).toEqual({ then: 42 });
  owner.dispose();
});
