import { commandSlot, commandSlots } from './program.js';
import { Context, Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { modelOwner } from './owner.js';
import { uiRuntime } from './runtime.js';

const commandTask = commandSlot('task');
const commandLoad = commandSlot('load');
const commandSame = commandSlot('same');
const commandCanceled = commandSlot('canceled');
const commandWork = commandSlot('work');
const commandRead = commandSlot('read');
const commandFail = commandSlot('fail');

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
      owner.run(commandTask, Effect.sync(work), 'replace');
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
  owner.run(commandLoad, work, 'replace');
  owner.run(commandLoad, work, 'drop');
  expect(start).toHaveBeenCalledTimes(1);
  owner.run(commandLoad, work, 'parallel');
  expect(start).toHaveBeenCalledTimes(2);
  owner.run(commandLoad, work, 'replace');
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  expect(owner.isRunning(commandLoad)).toBe(true);
  owner.cancel(commandLoad);
  await Effect.runPromise(owner.awaitIdle());
  await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(3));
  expect(owner.isRunning(commandLoad)).toBe(false);
  owner.dispose();
});

it('resolves task policies within a batch before executing commands and publishes before work', async () => {
  const owner = modelOwner({ count: 0 });
  const ran: number[] = [];
  owner.transaction(() => {
    owner.run(
      commandSame,
      Effect.sync(() => ran.push(-1)),
      'replace',
    );
    owner.run(
      commandSame,
      Effect.sync(() => ran.push(owner.read().count)),
      'replace',
    );
    owner.run(
      commandCanceled,
      Effect.sync(() => ran.push(-2)),
      'replace',
    );
    owner.cancel(commandCanceled);
    owner.patch({ count: 5 });
  });
  await Effect.runPromise(owner.awaitIdle());
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
    owner.run(commandWork, Effect.sync(work), 'replace');
  });
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

it('provides application services and reports failures without retaining a busy slot', async () => {
  class Value extends Context.Service<Value, { count: number }>()('OwnerValue') {}
  const onDefect = vi.fn();
  const owner = modelOwner(
    { count: 0 },
    { runtime: uiRuntime(Context.make(Value, { count: 42 })), onDefect },
  );
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
  expect(owner.isRunning(commandFail)).toBe(false);
  owner.dispose();
});

it('returns synchronous transaction values without treating plain data as a Promise', () => {
  const owner = modelOwner({ count: 0 });
  // A non-callable then field is ordinary synchronous data.
  // oxlint-disable-next-line unicorn/no-thenable -- Adversarial thenable verifies transaction rejection without executing it.
  expect(owner.transaction(() => ({ then: 42 }))).toEqual({ then: 42 });
  owner.dispose();
});

it('exposes only controller-selected fields with immutable published values', () => {
  const owner = modelOwner({ draft: '', selected: ['a'], result: 42 });
  const fields = owner.fields('draft', 'selected');
  fields.draft('edited');
  fields.selected(['b']);
  expect(Object.keys(fields)).toEqual(['draft', 'selected']);
  expect(owner.read()).toEqual({ draft: 'edited', selected: ['b'], result: 42 });
  expect(Object.isFrozen(owner.read().selected)).toBe(true);
  const typingOnly = () => {
    // @ts-expect-error Result publication remains owned by the controller.
    // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
    fields.result(0);
    // @ts-expect-error Setters retain the selected field's value type.
    fields.draft(42);
    // @ts-expect-error Field names must exist in the model.
    owner.fields('missing');
  };
  void typingOnly;
  owner.dispose();
});

it('replaces work per key through a declared slot family', async () => {
  const rowSlot = commandSlots('row');
  expect(rowSlot(1)).toBe(rowSlot(1));
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

it('rolls back cancellation and preserves the active command', async () => {
  const owner = modelOwner({});
  const stopped = vi.fn();
  const dropped = vi.fn();
  owner.run(commandLoad, Effect.never.pipe(Effect.ensuring(Effect.sync(stopped))), 'drop');
  expect(() =>
    owner.transaction(() => {
      owner.cancel(commandLoad);
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  owner.run(commandLoad, Effect.sync(dropped), 'drop');
  expect(stopped).not.toHaveBeenCalled();
  expect(dropped).not.toHaveBeenCalled();
  owner.transaction(() => owner.cancel(commandLoad));
  await Effect.runPromise(owner.awaitIdle());
  expect(stopped).toHaveBeenCalledOnce();
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

it('accumulates reentrant edits and keeps nested transaction rollback isolated', () => {
  const owner = modelOwner({ count: 0, label: '' });
  const published: number[] = [];
  owner.source.subscribe((snapshot) => {
    published.push(snapshot.count);
    if (snapshot.count !== 1) return;
    owner.edit('count', (count) => count + 1);
    owner.edit('count', (count) => count + 1);
    expect(owner.read().count).toBe(3);
    expect(() =>
      owner.transaction(() => {
        owner.patch({ count: 99 });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(owner.read().count).toBe(3);
    owner.transaction(() => {
      owner.patch({ label: String(owner.read().count) });
      owner.edit('count', (count) => count + 1);
    });
    expect(owner.read()).toEqual({ count: 4, label: '3' });
  });
  owner.patch({ count: 1 });
  expect(published).toEqual([1, 2, 3, 4]);
  expect(owner.source.model()).toEqual({ count: 4, label: '3' });
  owner.dispose();
});
