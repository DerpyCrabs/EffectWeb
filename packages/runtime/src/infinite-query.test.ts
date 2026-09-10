import { Context, Effect } from 'effect';
import { expect, it } from 'vitest';
import { infiniteQuery, infiniteResource } from './infinite-query.js';
import { makeQueryCache } from './cache.js';
import { uiRuntime } from './runtime.js';

it('shares initial and next loads, seeds, bounds pages and refreshes retained parameters', async () => {
  const loads: number[] = [];
  const definition = infiniteQuery({
    name: 'files',
    initial: 0,
    maxPages: 2,
    load: (_path: string, page: number) =>
      Effect.promise(async () => {
        loads.push(page);
        return [page];
      }),
    next: (_value, page) => page + 1,
  });
  const cache = makeQueryCache();
  const a = infiniteResource(cache, definition),
    b = infiniteResource(cache, definition);
  a.seed('root', { pages: [{ param: 0, value: [0] }], next: 1 });
  a.select('root');
  b.select('root');
  expect(loads).toEqual([]);
  await Promise.all([Effect.runPromise(a.loadNext()), Effect.runPromise(b.loadNext())]);
  expect(loads).toEqual([1]);
  expect(cache.getQueryData(definition.query, 'root')?.pages.map((page) => page.param)).toEqual([
    0, 1,
  ]);
  await Effect.runPromise(a.loadNext());
  expect(cache.getQueryData(definition.query, 'root')?.pages.map((page) => page.param)).toEqual([
    1, 2,
  ]);
  a.refresh();
  await Effect.runPromise(cache.prefetch(definition.query, 'root'));
  expect(loads).toEqual([1, 2, 1, 2]);
  expect(a.read()).toBe(b.read());
  a.dispose();
  b.dispose();
  cache.dispose();
});

it('retains typed errors and services, retries one page and rejects a stale append after reset', async () => {
  class Api extends Context.Service<
    Api,
    { load(page: number): Effect.Effect<number[], 'offline'> }
  >()('InfiniteTestApi') {}
  let fail = true;
  let release!: (value: number[]) => void;
  const definition = infiniteQuery({
    name: 'typed',
    initial: 0,
    load: (_path: string, page: number) => Effect.flatMap(Api, (api) => api.load(page)),
    next: (_value, page) => page + 1,
  });
  const runtime = uiRuntime(
    Context.make(Api, {
      load: (page) =>
        page === 1 && fail
          ? Effect.fail('offline' as const)
          : page === 2
            ? Effect.promise(
                () =>
                  new Promise<number[]>((resolve) => {
                    release = resolve;
                  }),
              )
            : Effect.succeed([page]),
    }),
  );
  const cache = makeQueryCache(runtime);
  const resource = infiniteResource(cache, definition);
  resource.select('a');
  expect((await Effect.runPromiseExit(resource.loadNext()))._tag).toBe('Failure');
  fail = false;
  await Effect.runPromise(resource.retryPage(1));
  expect(cache.getQueryData(definition.query, 'a')?.pages.length).toBe(2);
  const pending = Effect.runPromiseExit(resource.loadNext());
  cache.resetResources();
  release([2]);
  expect((await pending)._tag).toBe('Failure');
  expect(cache.getQueryData(definition.query, 'a')).toBeUndefined();
  resource.dispose();
  cache.dispose();
});

it('merges concurrent retries of different pages and coalesces retries of the same page', async () => {
  const pending = new Map<number, (value: number[]) => void>();
  const loads: number[] = [];
  const definition = infiniteQuery({
    name: 'retry-ranges',
    initial: 0,
    load: (_path: string, page: number) =>
      Effect.promise(() => {
        loads.push(page);
        return new Promise<number[]>((resolve) => pending.set(page, resolve));
      }),
    next: (_value, page) => page + 1,
  });
  const cache = makeQueryCache();
  const first = infiniteResource(cache, definition),
    second = infiniteResource(cache, definition);
  first.seed('/', {
    pages: [
      { param: 0, value: [0] },
      { param: 1, value: [1] },
    ],
    next: 2,
  });
  first.select('/');
  second.select('/');
  const a = Effect.runPromise(first.retryPage(0));
  const duplicate = Effect.runPromise(second.retryPage(0));
  const b = Effect.runPromise(second.retryPage(1));
  expect(loads).toEqual([0, 1]);
  pending.get(1)!([11]);
  await b;
  pending.get(0)!([10]);
  await Promise.all([a, duplicate]);
  expect(cache.getQueryData(definition.query, '/')?.pages.map((page) => page.value)).toEqual([
    [10],
    [11],
  ]);
  first.dispose();
  second.dispose();
  await Effect.runPromise(cache.close());
});

it('does not append an older page after an external refresh or after reset and reseeding the same key', async () => {
  let release!: (value: number[]) => void;
  let version = 0;
  const definition = infiniteQuery({
    name: 'refresh-race',
    initial: 0,
    load: (_path: string, page: number) =>
      page === 1
        ? Effect.promise(
            () =>
              new Promise<number[]>((resolve) => {
                release = resolve;
              }),
          ).pipe(Effect.uninterruptible)
        : Effect.succeed([version]),
    next: (_value, page) => page + 1,
  });
  const cache = makeQueryCache();
  const observer = infiniteResource(cache, definition);
  observer.select('/');
  const next = Effect.runPromise(observer.loadNext());
  version = 10;
  observer.refresh();
  release([1]);
  await next;
  expect(cache.getQueryData(definition.query, '/')?.pages.map((page) => page.value)).toEqual([
    [10],
  ]);
  const stale = Effect.runPromiseExit(observer.loadNext());
  cache.resetResources();
  observer.seed('/', { pages: [{ param: 0, value: [99] }], next: 1 });
  observer.select('/');
  release([2]);
  await stale;
  expect(cache.getQueryData(definition.query, '/')?.pages.map((page) => page.value)).toEqual([
    [99],
  ]);
  observer.dispose();
  await Effect.runPromise(cache.close());
});

it('supports first-page refresh explicitly and validates seed ranges and cursors', async () => {
  let version = 0;
  const definition = infiniteQuery({
    name: 'first-page',
    initial: 0,
    refresh: 'first',
    maxPages: 2,
    load: (_path: string, page: number) => Effect.succeed([page, version]),
    next: (_value, page) => page + 1,
  });
  const cache = makeQueryCache();
  const observer = infiniteResource(cache, definition);
  observer.select('/');
  await Effect.runPromise(observer.loadNext());
  version = 1;
  observer.refresh();
  expect(cache.getQueryData(definition.query, '/')?.pages.length).toBe(1);
  await Effect.runPromise(observer.loadNext());
  expect(cache.getQueryData(definition.query, '/')?.pages[1]?.value).toEqual([1, 1]);
  expect(() => observer.seed('/', { pages: [], next: 0 })).toThrow('Seed pages');
  expect(() =>
    observer.seed('/', {
      pages: [
        { param: 0, value: [] },
        { param: 0, value: [] },
      ],
      next: 1,
    }),
  ).toThrow('unique');
  expect((await Effect.runPromiseExit(observer.retryPage(9)))._tag).toBe('Failure');
  observer.dispose();
  await Effect.runPromise(cache.close());
});
