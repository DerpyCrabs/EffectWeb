import { Context, Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { modelOwner } from './owner.js';

const commandLoad = 'load';
const commandWork = 'work';
const commandRead = 'read';
const commandFail = 'fail';

it('owns replace, drop and parallel work and cancels the whole named group', async () => {
  const owner = modelOwner({ count: 0 });
  const start = vi.fn(),
    stop = vi.fn();
  const work = Effect.sync(start).pipe(
    Effect.andThen(Effect.never),
    Effect.ensuring(Effect.sync(stop)),
  );
  owner.run(commandLoad, work, 'replace');
  owner.run(commandLoad, work, 'drop');
  expect(start).toHaveBeenCalledTimes(1);
  owner.run(commandLoad, work, 'parallel');
  expect(start).toHaveBeenCalledTimes(2);
  owner.run(commandLoad, work, 'replace');
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  owner.cancel(commandLoad);
  await Effect.runPromise(owner.awaitIdle());
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(3));
  owner.dispose();
});

it('disposes resources, suppresses later writes and prevents work after listener-driven disposal', () => {
  const owner = modelOwner({ count: 0 });
  const dispose = vi.fn(),
    work = vi.fn();
  owner.own({ dispose });
  owner.source.subscribe(() => owner.dispose());
  owner.patch({ count: 1 });
  owner.run(commandWork, Effect.sync(work), 'replace');
  owner.source.dispose();
  owner.patch({ count: 10 });
  owner.edit('count', (n) => n + 1);
  owner.run(commandWork, Effect.sync(work), 'replace');
  expect(work).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
  const late = vi.fn();
  owner.own({ dispose: late });
  expect(late).toHaveBeenCalledOnce();
});

it('provides application services and reports failures without retaining a busy key', async () => {
  class Value extends Context.Service<Value, { count: number }>()('OwnerValue') {}
  const onDefect = vi.fn();
  const owner = modelOwner({ count: 0 }, { context: Context.make(Value, { count: 42 }), onDefect });
  owner.run(
    commandRead,
    Effect.flatMap(Value, (value) => Effect.sync(() => owner.patch(value))),
    'replace',
  );
  await Effect.runPromise(owner.awaitIdle());
  expect(owner.read().count).toBe(42);
  owner.run(commandFail, Effect.fail('offline'), 'replace');
  await Effect.runPromise(owner.awaitIdle());
  expect(onDefect).toHaveBeenCalledOnce();
  owner.dispose();
});

it('replaces work per composite key', async () => {
  const rowSlot = (key: string | number) => ['row', key] as const;
  expect(rowSlot(1)).toEqual(rowSlot(1));
  expect(rowSlot(1)).not.toBe(rowSlot(2));
  const owner = modelOwner({ done: [] as string[] });
  const finish = (label: string) =>
    Effect.sleep(5).pipe(
      Effect.andThen(Effect.sync(() => owner.edit('done', (done) => [...done, label]))),
    );
  owner.run(rowSlot(1), finish('1a'), 'replace');
  owner.run(rowSlot(2), finish('2a'), 'replace');
  owner.run(rowSlot(1), finish('1b'), 'replace');
  await Effect.runPromise(owner.awaitIdle());
  expect([...owner.read().done].sort()).toEqual(['1b', '2a']);
  owner.dispose();
});

it('releases scoped resources before starting the next queued command', async () => {
  const owner = modelOwner({});
  const events: number[] = [];
  let finish!: () => void;
  owner.run(
    commandLoad,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.sync(() => events.push(2)));
      yield* Effect.callback<void>((resume) => {
        finish = () => resume(Effect.void);
      });
    }),
    'queue',
  );
  owner.run(
    commandLoad,
    Effect.sync(() => events.push(3)),
    'queue',
  );
  expect(events).toEqual([]);
  finish();
  await Effect.runPromise(owner.awaitIdle());
  expect(events).toEqual([2, 3]);
  owner.dispose();
});

it('allows new commands after cancellation while an async finalizer drains', async () => {
  const owner = modelOwner({ count: 0 });
  let release!: () => void;
  owner.run(
    commandLoad,
    Effect.never.pipe(
      Effect.ensuring(
        Effect.callback<void>((resume) => {
          release = () => resume(Effect.void);
        }),
      ),
    ),
    'drop',
  );
  owner.cancel(commandLoad);
  owner.run(
    commandLoad,
    Effect.sync(() => owner.patch({ count: 8 })),
    'drop',
  );
  expect(owner.read().count).toBe(8);
  release();
  await Effect.runPromise(owner.awaitIdle());
  owner.dispose();
});

it('discards reentrant commands when disposed before admission', () => {
  const owner = modelOwner({ count: 0 });
  const work = vi.fn();
  owner.source.subscribe(() => {
    owner.run(commandLoad, Effect.sync(work), 'queue');
    owner.dispose();
  });
  owner.patch({ count: 1 });
  expect(work).not.toHaveBeenCalled();
});

it('respects reentrant cancellation before admitting a new command', async () => {
  const owner = modelOwner({ count: 0 });
  const work = vi.fn();
  owner.source.subscribe(() => {
    owner.run(commandLoad, Effect.never, 'drop');
    owner.cancel(commandLoad);
    owner.run(commandLoad, Effect.sync(work), 'drop');
  });
  owner.patch({ count: 1 });
  await Effect.runPromise(owner.awaitIdle());
  expect(work).toHaveBeenCalledOnce();
  owner.dispose();
});

it('reads accepted writes synchronously during command startup', async () => {
  const owner = modelOwner({ first: 0, second: 0 });
  let read: unknown;
  owner.run(
    commandWork,
    Effect.sync(() => {
      owner.patch({ first: 1 });
      const written = owner.read().first;
      owner.patch({ second: written });
      read = owner.read();
    }),
    'drop',
  );
  await Effect.runPromise(owner.awaitIdle());
  expect(read).toEqual({ first: 1, second: 1 });
  expect(owner.source.model()).toEqual(read);
  owner.dispose();
});

it('accumulates reentrant edits against the accepted state and publishes each in order', () => {
  const owner = modelOwner({ count: 0, label: '' });
  const published: number[] = [];
  owner.source.subscribe((snapshot) => {
    published.push(snapshot.count);
    if (snapshot.count !== 1) return;
    owner.edit('count', (count) => count + 1);
    owner.edit('count', (count) => count + 1);
    expect(owner.read().count).toBe(3);
    expect(owner.source.model().count).toBe(1);
    owner.patch({ label: String(owner.read().count) });
    owner.edit('count', (count) => count + 1);
    expect(owner.read()).toEqual({ count: 4, label: '3' });
  });
  owner.patch({ count: 1 });
  expect(published).toEqual([1, 2, 3, 3, 4]);
  expect(owner.source.model()).toEqual({ count: 4, label: '3' });
  owner.dispose();
});

it('owns plain cleanup functions and runs them on dispose', () => {
  const owner = modelOwner({ count: 0 });
  const unsubscribe = vi.fn();
  expect(owner.own(unsubscribe)).toBe(unsubscribe);
  expect(unsubscribe).not.toHaveBeenCalled();
  owner.dispose();
  expect(unsubscribe).toHaveBeenCalledOnce();
  const late = vi.fn();
  owner.own(late);
  expect(late).toHaveBeenCalledOnce();
});
