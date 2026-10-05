import { expect, test } from 'vite-plus/test';
import { Effect } from 'effect';
import { infiniteQuery, infiniteResource } from './infinite-query.js';
import { queryCache } from './cache.js';
import { queryDefinition } from './query-internals.js';

test('infinite queries forward freshness and unused policy to aggregate and page queries', async () => {
  let calls = 0;
  const definition = infiniteQuery({
    name: 'fresh-directory',
    initial: 1,
    staleTime: 0,
    unused: 'cancel',
    load: (_args: { search: string }, _page: number) => Effect.sync(() => ++calls),
    next: () => undefined,
  });
  expect(queryDefinition(definition.query).staleTime).toBe(0);
  expect(queryDefinition(definition.page).staleTime).toBe(0);
  expect(queryDefinition(definition.page).unused).toBe('cancel');
  const cache = queryCache();
  const first = infiniteResource(cache, definition);
  first.select({ search: '' });
  await Effect.runPromise(cache.prefetch(definition.query, { search: '' }));
  first.dispose();
  const before = calls;
  const second = infiniteResource(cache, definition);
  second.select({ search: '' });
  await Effect.runPromise(cache.prefetch(definition.query, { search: '' }));
  expect(calls).toBeGreaterThan(before);
  second.dispose();
  cache.dispose();
});
test('infinite query defaults remain unchanged and invalid freshness is rejected', () => {
  const options = {
    name: 'default',
    initial: 1,
    load: (_args: true) => Effect.succeed(1),
    next: () => undefined,
  };
  expect(queryDefinition(infiniteQuery(options).query).staleTime).toBe(Infinity);
  expect(() => infiniteQuery({ ...options, staleTime: -1 })).toThrow();
});
