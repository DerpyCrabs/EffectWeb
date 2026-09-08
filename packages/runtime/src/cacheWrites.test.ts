import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { afterEach, expect, it, vi } from 'vitest';
import { makeQueryCache, type QueryCache } from './cache.js';
import { query } from './query.js';
import { queryResource } from './session.js';
import { available } from './resource.js';

const caches: QueryCache[] = [];
const makeCache = () => {
  const cache = makeQueryCache();
  caches.push(cache);
  return cache;
};
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
});

it('seeds readonly data without loading and publishes protected updates to both observers', async () => {
  const load = vi.fn((_args: { ids: readonly string[] }) =>
    Effect.succeed({ names: ['network'], detail: { count: 1 } }),
  );
  const definition = query<{ ids: string[] }, { names: string[]; detail: { count: number } }>({
    name: 'people',
    load,
  });
  const cache = makeCache();
  const args = { ids: ['a'] } as const;
  const seed = { names: ['Ada'], detail: { count: 1 } };
  const written = cache.setQueryData(definition, args, seed);
  const first = queryResource({ cache }, definition);
  const second = queryResource({ cache }, definition);
  first.select(args);
  second.select({ ids: ['a'] });
  expect(load).not.toHaveBeenCalled();
  expect(available(first.read())).toBe(written);
  expect(available(second.read())).toBe(written);
  expect(await Effect.runPromise(cache.prefetch(definition, args))).toBe(written);
  expect(() => seed.names.push('retained mutation')).toThrow(TypeError);
  const updated = cache.updateQueryData(definition, args, (previous) => ({
    ...previous,
    names: [...previous.names, 'Grace'],
  }));
  expect(available(first.read())).toBe(updated);
  expect(available(second.read())).toBe(updated);
  expect(updated?.detail).toBe(written.detail);
  expect(Object.isFrozen(updated?.names)).toBe(true);
  expect(written.names).toEqual(['Ada']);
  first.dispose();
  second.dispose();
});

it('supersedes a prefetched request and rejects its late result for every observer', async () => {
  let finish!: (value: { version: number }) => void;
  const interrupted = vi.fn<() => void>();
  const load = vi.fn(() =>
    Effect.promise(
      () =>
        new Promise<{ version: number }>((resolve) => {
          finish = resolve;
        }),
    ).pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
  );
  const definition = query({ name: 'document', load });
  const cache = makeCache();
  const prefetched = Effect.runPromise(cache.prefetch(definition, true));
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  const first = queryResource({ cache }, definition);
  const second = queryResource({ cache }, definition);
  first.select(true);
  second.select(true);
  expect(first.read().waiting).toBe(true);
  const written = cache.setQueryData(definition, true, { version: 2 });
  expect(await prefetched).toBe(written);
  expect(available(first.read())).toBe(written);
  expect(available(second.read())).toBe(written);
  expect(first.read().waiting).toBe(false);
  expect(interrupted).toHaveBeenCalledTimes(1);
  finish({ version: 1 });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(await Effect.runPromise(cache.prefetch(definition, true))).toBe(written);
  expect(available(second.read())).toBe(written);
  expect(
    cache.updateQueryData(definition, true, (value) => ({ version: value.version + 1 })),
  ).toEqual({ version: 3 });
  expect(load).toHaveBeenCalledTimes(1);
  first.dispose();
  second.dispose();
});

it('updates an unobserved prefetched success without starting a stale refetch', async () => {
  const load = vi.fn(() => Effect.succeed(1));
  const definition = query({ name: 'prefetched-counter', staleTime: 0, load });
  const cache = makeCache();
  expect(await Effect.runPromise(cache.prefetch(definition, true))).toBe(1);
  expect(cache.updateQueryData(definition, true, (previous) => previous + 1)).toBe(2);
  expect(load).toHaveBeenCalledTimes(1);
});

it('updates previous success after failure but skips a failure without cached data', () => {
  const definition = query<string, number, string>({
    name: 'failing-counter',
    load: () => Effect.fail('offline'),
  });
  const cache = makeCache();
  cache.setQueryData(definition, 'seeded', 1);
  const seeded = queryResource({ cache }, definition);
  const absent = queryResource({ cache }, definition);
  seeded.select('seeded');
  absent.select('absent');
  cache.invalidateQuery(definition, 'seeded');
  expect(seeded.read()._tag).toBe('Failure');
  expect(cache.updateQueryData(definition, 'seeded', (previous) => previous + 1)).toBe(2);
  expect(seeded.read()._tag).toBe('Success');
  expect(available(seeded.read())).toBe(2);
  const update = vi.fn(() => 3);
  expect(cache.updateQueryData(definition, 'absent', update)).toBeUndefined();
  expect(update).not.toHaveBeenCalled();
  seeded.dispose();
  absent.dispose();
});

it('does not revive a success whose idle registry entry has expired', async () => {
  vi.useFakeTimers();
  const cache = makeCache();
  try {
    const load = vi.fn(() => Effect.succeed('network'));
    const definition = query({ name: 'expired', load });
    cache.setQueryData(definition, true, 'seed');
    await vi.advanceTimersByTimeAsync(60_000);
    const update = vi.fn(() => 'revived');
    expect(cache.updateQueryData(definition, true, update)).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(await Effect.runPromise(cache.prefetch(definition, true))).toBe('network');
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    cache.dispose();
    vi.useRealTimers();
  }
});

it('updates the previous success during a refetch and leaves other keys and definitions alone', async () => {
  let finish!: (value: number) => void;
  const definition = query({
    name: 'counter',
    load: (_id: string) =>
      Effect.promise(
        () =>
          new Promise<number>((resolve) => {
            finish = resolve;
          }),
      ),
  });
  const other = query({ name: 'counter', load: (_id: string) => Effect.succeed(99) });
  const cache = makeCache();
  cache.setQueryData(definition, 'a', 1);
  cache.setQueryData(definition, 'b', 10);
  cache.setQueryData(other, 'a', 100);
  const source = queryResource({ cache }, definition);
  source.select('a');
  cache.invalidateQuery(definition, 'a');
  expect(source.read().waiting).toBe(true);
  expect(cache.updateQueryData(definition, 'a', (value) => value + 1)).toBe(2);
  finish(0);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(await Effect.runPromise(cache.prefetch(definition, 'a'))).toBe(2);
  expect(await Effect.runPromise(cache.prefetch(definition, 'b'))).toBe(10);
  expect(await Effect.runPromise(cache.prefetch(other, 'a'))).toBe(100);
  source.dispose();
});

it('distinguishes an absent value, skipped updates and a successful undefined value', async () => {
  const load = vi.fn(() => Effect.succeed<string | undefined>('network'));
  const definition = query({ name: 'optional', load });
  const cache = makeCache();
  const absent = vi.fn(() => 'created');
  expect(cache.updateQueryData(definition, true, absent)).toBeUndefined();
  expect(absent).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  cache.setQueryData(definition, true, undefined);
  const source = queryResource({ cache }, definition);
  source.select(true);
  expect(Option.isSome(AsyncResult.value(source.read()))).toBe(true);
  const skip = vi.fn((value: string | undefined) => {
    expect(value).toBeUndefined();
    return undefined;
  });
  expect(cache.updateQueryData(definition, true, skip)).toBeUndefined();
  expect(skip).toHaveBeenCalledTimes(1);
  expect(Option.isSome(AsyncResult.value(source.read()))).toBe(true);
  expect(load).not.toHaveBeenCalled();
  expect(await Effect.runPromise(cache.prefetch(definition, true))).toBeUndefined();
  expect(cache.updateQueryData(definition, true, () => 'present')).toBe('present');
  expect(cache.updateQueryData(definition, true, () => undefined)).toBeUndefined();
  expect(available(source.read())).toBe('present');
  source.dispose();
});

it('preserves published data on updater errors and never invokes an updater after disposal', () => {
  const definition = query({ name: 'counter', load: () => Effect.succeed({ count: 0 }) });
  const cache = makeCache();
  const source = queryResource({ cache }, definition);
  cache.setQueryData(definition, true, { count: 1 });
  source.select(true);
  const before = source.read();
  expect(() =>
    cache.updateQueryData(definition, true, () => {
      throw new Error('update');
    }),
  ).toThrow('update');
  expect(source.read()).toBe(before);
  source.dispose();
  cache.dispose();
  const update = vi.fn(() => ({ count: 2 }));
  expect(() => cache.updateQueryData(definition, true, update)).toThrow(/disposed/);
  expect(update).not.toHaveBeenCalled();
  expect(() => cache.setQueryData(definition, true, { count: 2 })).toThrow(/disposed/);
});

it('invalidates seeded values normally and reset drops them before the next selection', async () => {
  const load = vi.fn((id: string) => Effect.succeed(`network:${id}`));
  const definition = query({ name: 'document', load });
  const cache = makeCache();
  cache.setQueryData(definition, 'a', 'seed:a');
  cache.setQueryData(definition, 'b', 'seed:b');
  const first = queryResource({ cache }, definition);
  const second = queryResource({ cache }, definition);
  first.select('a');
  second.select('b');
  cache.invalidateQuery(definition, 'a');
  expect(await Effect.runPromise(cache.prefetch(definition, 'a'))).toBe('network:a');
  expect(available(second.read())).toBe('seed:b');
  expect(load).toHaveBeenCalledTimes(1);
  cache.resetResources();
  expect(first.read()._tag).toBe('Initial');
  expect(second.read()._tag).toBe('Initial');
  first.select('a');
  second.select('b');
  expect(available(first.read())).toBe('network:a');
  expect(available(second.read())).toBe('network:b');
  expect(load).toHaveBeenCalledTimes(3);
  first.dispose();
  second.dispose();
});

it('applies custom sharing to writes and does not corrupt a value if sharing throws', () => {
  const definition = query({
    name: 'rows',
    load: () => Effect.succeed([{ id: 1, label: 'loaded' }]),
    share: (previous, next) => {
      if (next[0]?.label === 'invalid') throw new Error('share');
      return previous[0]?.id === next[0]?.id ? previous : next;
    },
  });
  const cache = makeCache();
  const first = cache.setQueryData(definition, true, [{ id: 1, label: 'original' }]);
  expect(cache.setQueryData(definition, true, [{ id: 1, label: 'ignored' }])).toBe(first);
  const source = queryResource({ cache }, definition);
  source.select(true);
  const before = source.read();
  expect(() => cache.setQueryData(definition, true, [{ id: 2, label: 'invalid' }])).toThrow(
    'share',
  );
  expect(source.read()).toBe(before);
  expect(available(source.read())).toBe(first);
  source.dispose();
});
