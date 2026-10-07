import { Context, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { expect, it } from 'vitest';
import { fetchNextPage, infiniteQuery, infiniteResource } from './infinite-query.js';
import { querySource } from './observe.js';
import { queryCache } from './cache.js';

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
  const cache = queryCache();
  const a = infiniteResource(cache, definition),
    b = infiniteResource(cache, definition);
  a.seed('root', { pages: [{ param: 0, value: [0] }], next: 1 });
  a.select('root');
  b.select('root');
  expect(loads).toEqual([]);
  await Promise.all([Effect.runPromise(a.fetchNextPage()), Effect.runPromise(b.fetchNextPage())]);
  expect(loads).toEqual([1]);
  expect(cache.getQueryData(definition.query, 'root')?.pages.map((page) => page.param)).toEqual([
    0, 1,
  ]);
  await Effect.runPromise(a.fetchNextPage());
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

it('retains typed errors and services, loads the failed page again and rejects a stale append after reset', async () => {
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
  const context = Context.make(Api, {
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
  });
  const cache = queryCache(context);
  const resource = infiniteResource(cache, definition);
  resource.select('a');
  expect((await Effect.runPromiseExit(resource.fetchNextPage()))._tag).toBe('Failure');
  fail = false;
  await Effect.runPromise(resource.fetchNextPage());
  expect(cache.getQueryData(definition.query, 'a')?.pages.length).toBe(2);
  const pending = Effect.runPromiseExit(resource.fetchNextPage());
  cache.resetResources();
  release([2]);
  expect((await pending)._tag).toBe('Failure');
  expect(cache.getQueryData(definition.query, 'a')).toBeUndefined();
  resource.dispose();
  cache.dispose();
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
  const cache = queryCache();
  const observer = infiniteResource(cache, definition);
  observer.select('/');
  const next = Effect.runPromise(observer.fetchNextPage());
  version = 10;
  observer.refresh();
  release([1]);
  await next;
  expect(cache.getQueryData(definition.query, '/')?.pages.map((page) => page.value)).toEqual([
    [10],
  ]);
  const stale = Effect.runPromiseExit(observer.fetchNextPage());
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
  const cache = queryCache();
  const observer = infiniteResource(cache, definition);
  observer.select('/');
  await Effect.runPromise(observer.fetchNextPage());
  version = 1;
  observer.refresh();
  expect(cache.getQueryData(definition.query, '/')?.pages.length).toBe(1);
  await Effect.runPromise(observer.fetchNextPage());
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
  observer.dispose();
  await Effect.runPromise(cache.close());
});

it('reads infinite queries through querySource and extends them with fetchNextPage', async () => {
  const cache = queryCache();
  const numbers = infiniteQuery({
    name: 'source-numbers',
    initial: 0,
    load: (_args: { list: string }, offset: number) => Effect.succeed([offset, offset + 1]),
    next: (_page, offset) => (offset < 2 ? offset + 2 : undefined),
  });
  const source = querySource(cache, numbers, { list: 'a' });
  const seen: number[][] = [];
  const stop = source.subscribe((result) => {
    const data = Option.getOrUndefined(AsyncResult.value(result));
    if (data) seen.push(data.pages.flatMap((page) => [...page.value]));
  });
  await Effect.runPromise(Effect.yieldNow);
  const first = Option.getOrUndefined(AsyncResult.value(source.model()));
  expect(first?.pages.flatMap((page) => [...page.value])).toEqual([0, 1]);
  const extended = await Effect.runPromise(fetchNextPage(cache, numbers, { list: 'a' }));
  expect(extended.next).toBeUndefined();
  expect(seen.at(-1)).toEqual([0, 1, 2, 3]);
  stop();
  cache.dispose();
});
