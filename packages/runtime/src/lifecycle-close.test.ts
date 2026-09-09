import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';
import { commandSlot } from './program.js';

it('joins replaced and active finalizers before closing dependencies, once', async () => {
  const owner = modelOwner({});
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  owner.own({
    dispose() {
      order.push('dependency');
    },
  });
  const slot = commandSlot('work');
  owner.run(
    slot,
    Effect.never.pipe(
      Effect.ensuring(
        Effect.promise(async () => {
          order.push('start');
          await gate;
          order.push('end');
        }),
      ),
    ),
    'replace',
  );
  owner.run(slot, Effect.never, 'replace');
  const closed = owner.close();
  expect(owner.close()).toBe(closed);
  await owner.awaitIdle();
  expect(order).toEqual(['start']);
  release();
  await closed;
  expect(order).toEqual(['start', 'end', 'dependency']);
});

it('runs every dependency close in reverse order and reports failures to the caller', async () => {
  const owner = modelOwner({});
  const order: number[] = [];
  owner.own({
    dispose() {
      order.push(1);
    },
  });
  owner.own({
    dispose() {},
    async close() {
      order.push(2);
      throw new Error('failed');
    },
  });
  await expect(owner.close()).rejects.toThrow('Owner cleanup failed');
  expect(order).toEqual([2, 1]);
});

it('tracks closure requested while synchronous work is starting', async () => {
  const owner = modelOwner({});
  let closed!: Promise<void>;
  let finalized = false;
  owner.run(
    commandSlot('reentrant'),
    Effect.sync(() => {
      closed = owner.close();
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          finalized = true;
        }),
      ),
    ),
    'replace',
  );
  await closed;
  expect(finalized).toBe(true);
});

it('returns the same owner close promise to a reentrant cancellation finalizer', async () => {
  const owner = modelOwner({});
  let inside: Promise<void> | undefined;
  owner.run(
    commandSlot('reentrant-close'),
    Effect.never.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          inside = owner.close();
        }),
      ),
    ),
    'replace',
  );
  const outside = owner.close();
  expect(inside).toBe(outside);
  await outside;
});
