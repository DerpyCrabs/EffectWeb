import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { encodeQueryKey, query, type QueryKey } from './query.js';
import { makeQueryCache } from './cache.js';
import { cacheInternals } from './cache-internals.js';
import { queryResource } from './session.js';

it('encodes structured identities with canonical object ordering and distinct scalar types', () => {
  expect(encodeQueryKey(['feed', { account: 'a', page: 1 }])).toBe(
    encodeQueryKey(['feed', { page: 1, account: 'a' }]),
  );
  const distinct: QueryKey[] = [
    undefined,
    null,
    false,
    true,
    '',
    'undefined',
    'null',
    0,
    -0,
    '0',
    1,
    '1',
    [],
    [undefined],
    [null],
    {},
    { value: undefined },
    { value: null },
    ['a:b', 'c'],
    ['a', 'b:c'],
    ['a,b'],
    ['a', 'b'],
    'a["a","b"]',
  ];
  expect(new Set(distinct.map(encodeQueryKey)).size).toBe(distinct.length);
  const shared = { id: 1 };
  expect(encodeQueryKey([shared, shared])).toBe(encodeQueryKey([{ id: 1 }, { id: 1 }]));
});

it('rejects unsupported inputs without executing getters', () => {
  const cyclic: QueryKey[] = [];
  cyclic.push(cyclic);
  let reads = 0;
  const getter = {
    get value() {
      reads++;
      return 1;
    },
  };
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const extra = Object.assign([1], { extra: true });
  const invalid = [
    NaN,
    Infinity,
    -Infinity,
    1n,
    Symbol('key'),
    () => 1,
    new Date(),
    new (class extends Array {})(),
    new Map(),
    new Set(),
    /a/,
    cyclic,
    getter,
    hidden,
    extra,
    Array(1),
    { [Symbol('key')]: 1 },
  ];
  for (const key of invalid) expect(() => encodeQueryKey(key as QueryKey)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it('uses the same identity for query cache acquisition, selection, prefetch and invalidation', async () => {
  const cache = makeQueryCache();
  let loads = 0;
  const definition = query({
    name: 'structured',
    load: (_args: { account: string; filter: { page: number; search?: string } }) =>
      Effect.sync(() => ++loads),
  });
  const first = { account: 'a', filter: { page: 1, search: 'x' } };
  const reordered = { account: 'a', filter: { search: 'x', page: 1 } };
  const source = queryResource({ cache }, definition);
  source.select(first);
  await Effect.runPromise(cache.prefetch(definition, first));
  const before = source.read();
  source.select(reordered);
  expect(source.read()).toBe(before);
  expect(cacheInternals(cache).query(definition, first)).toBe(
    cacheInternals(cache).query(definition, reordered),
  );
  expect(await Effect.runPromise(cache.prefetch(definition, reordered))).toBe(1);
  cache.invalidateQuery(definition, reordered);
  expect(await Effect.runPromise(cache.prefetch(definition, first))).toBe(2);
  source.select({ account: 'b', filter: { page: 1, search: 'x' } });
  expect(await Effect.runPromise(cache.prefetch(definition, { ...first, account: 'b' }))).toBe(3);
  source.dispose();
  cache.dispose();
});

it('preserves string keys and isolates definitions and cache ownership', async () => {
  const first = query({ name: 'same', load: (id: string) => Effect.succeed(id) });
  const second = query({ name: 'same', load: (id: string) => Effect.succeed(id) });
  const a = makeQueryCache();
  const b = makeQueryCache();
  expect(cacheInternals(a).query(first, 'a:b')).toBe(cacheInternals(a).query(first, 'a:b'));
  expect(cacheInternals(a).query(first, 'a:b')).not.toBe(cacheInternals(a).query(second, 'a:b'));
  expect(cacheInternals(a).query(first, 'a:b')).not.toBe(cacheInternals(b).query(first, 'a:b'));
  a.resetResources();
  expect(await Effect.runPromise(a.prefetch(first, 'new-account'))).toBe('new-account');
  a.dispose();
  b.dispose();
});

it('changes selections when any nested request argument changes', () => {
  const cache = makeQueryCache();
  const definition = query({
    name: 'items',
    load: (args: { filter: { id: string; status: string } }) => Effect.succeed(args.filter.status),
  });
  const resource = queryResource({ cache }, definition);
  resource.select({ filter: { id: 'same', status: 'open' } });
  expect(resource.read()).toMatchObject({ _tag: 'Success', value: 'open' });
  resource.select({ filter: { id: 'same', status: 'closed' } });
  expect(resource.read()).toMatchObject({ _tag: 'Success', value: 'closed' });
  resource.dispose();
  cache.dispose();
});

it('cannot forge a definition by copying a public query', async () => {
  const cache = makeQueryCache();
  const original = query({ name: 'number', load: () => Effect.succeed(123) });
  const copied = { ...original };
  expect(await Effect.runPromiseExit(cache.prefetch(copied, true))).toMatchObject({
    _tag: 'Failure',
  });
  cache.dispose();
});
