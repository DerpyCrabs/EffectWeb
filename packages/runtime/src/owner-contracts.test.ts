import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { modelOwner } from './owner.js';

it('patch/read can replace edit, but sequential patches cannot replace transaction atomicity or rollback', async () => {
  const owner = modelOwner({ count: 0, label: 'initial' });
  const published: Array<{ count: number; label: string }> = [];
  const work = vi.fn();
  owner.source.subscribe((model) => published.push(model));
  owner.patch({ count: owner.read().count + 1 });
  owner.edit('count', (count) => count + 1);
  expect(owner.read().count).toBe(2);
  published.length = 0;
  expect(() =>
    owner.transaction(() => {
      owner.patch({ count: 3 });
      owner.patch({ label: 'staged' });
      owner.run('save', Effect.sync(work), 'queue');
      expect(owner.read().label).toBe('staged');
      expect(owner.source.model().label).toBe('initial');
      throw new Error('abort');
    }),
  ).toThrow('abort');
  expect(published).toEqual([]);
  expect(work).not.toHaveBeenCalled();
  expect(owner.read()).toEqual({ count: 2, label: 'initial' });
  owner.transaction(() => {
    owner.patch({ count: 3 });
    owner.patch({ label: 'committed' });
  });
  expect(published).toEqual([{ count: 3, label: 'committed' }]);
  await Effect.runPromise(owner.close());
});

it('run handles observe one execution; owned dependencies close only after work finalizes', async () => {
  const order: string[] = [];
  const owner = modelOwner({});
  owner.own({
    dispose: () => {
      order.push('dispose');
    },
    close: () =>
      Effect.sync(() => {
        order.push('dependency');
      }),
  });
  const run = owner.run(
    'job',
    Effect.sync(() => {
      order.push('start');
    }).pipe(
      Effect.andThen(Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          order.push('finalizer');
        }),
      ),
    ),
    'replace',
  );
  expect(owner.isRunning('job')).toBe(true);
  await Effect.runPromise(owner.close());
  const first = await Effect.runPromise(run.await);
  const second = await Effect.runPromise(run.await);
  expect(first).toEqual(second);
  expect(first._tag).toBe('Failure');
  expect(owner.isRunning('job')).toBe(false);
  expect(order.indexOf('dependency')).toBeGreaterThan(order.indexOf('finalizer'));
  expect(order.filter((item) => item === 'start')).toHaveLength(1);
});
