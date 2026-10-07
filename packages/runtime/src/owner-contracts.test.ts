import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';

it('patch and edit publish each accepted change in order', async () => {
  const owner = modelOwner({ count: 0, label: 'initial' });
  const published: Array<{ count: number; label: string }> = [];
  owner.source.subscribe((model) => published.push(model));
  owner.patch({ count: owner.read().count + 1 });
  owner.edit('count', (count) => count + 1);
  expect(owner.read().count).toBe(2);
  owner.patch({ label: 'changed' });
  owner.patch({ label: 'changed' });
  expect(published).toEqual([
    { count: 1, label: 'initial' },
    { count: 2, label: 'initial' },
    { count: 2, label: 'changed' },
  ]);
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
  await Effect.runPromise(owner.close());
  const first = await Effect.runPromise(run.await);
  const second = await Effect.runPromise(run.await);
  expect(first).toEqual(second);
  expect(first._tag).toBe('Failure');
  expect(order.indexOf('dependency')).toBeGreaterThan(order.indexOf('finalizer'));
  expect(order.filter((item) => item === 'start')).toHaveLength(1);
});
