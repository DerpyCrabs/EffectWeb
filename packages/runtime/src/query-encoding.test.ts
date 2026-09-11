import { Data, Effect, Option } from 'effect';
import * as TestClock from 'effect/testing/TestClock';
import { expect, it } from 'vitest';
import { makeQueryCache, scopedQueryCache } from './cache.js';
import { query } from './query.js';
import { queryResource } from './session.js';
import { infiniteQuery, infiniteResource } from './infinite-query.js';

class Request extends Data.Class<{ readonly id: string; readonly filter: Option.Option<string> }> {}
const encode = (args: Request) => ({ id: args.id, filter: Option.getOrNull(args.filter) });

it('uses explicit Effect-value encoding consistently for lookup, selection, writes and invalidation', async () => {
  const cache = makeQueryCache();
  let loads = 0;
  const definition = query({
    name: 'effect-data',
    encode,
    load: (_args: Request) => Effect.sync(() => ++loads),
  });
  const first = new Request({ id: 'one', filter: Option.some('open') });
  const equal = new Request({ id: 'one', filter: Option.some('open') });
  const source = queryResource({ cache }, definition);
  source.select(first);
  const original = source.read();
  source.select(equal);
  expect(source.read()).toBe(original);
  expect(await Effect.runPromise(cache.prefetch(definition, equal))).toBe(1);
  cache.setQueryData(definition, equal, 10);
  expect(cache.getQueryData(definition, first)).toBe(10);
  cache.updateQueryData(definition, first, (value) => value + 1);
  expect(cache.getQueryData(definition, equal)).toBe(11);
  cache.invalidateQuery(definition, equal);
  expect(await Effect.runPromise(cache.prefetch(definition, first))).toBe(2);
  source.select(new Request({ id: 'one', filter: Option.some('closed') }));
  expect(loads).toBe(3);
  source.dispose();
  await Effect.runPromise(cache.close());
});

it('uses the same explicit cursor encoding for pagination and retries', async () => {
  class Cursor extends Data.Class<{ readonly page: number }> {}
  const definition = infiniteQuery({
    name: 'effect-pages',
    initial: new Cursor({ page: 1 }),
    encodeArgs: encode,
    encodeParam: (cursor: Cursor) => cursor.page,
    load: (args: Request, cursor: Cursor) => Effect.succeed(`${args.id}:${cursor.page}`),
    next: (_value: string, cursor: Cursor) =>
      cursor.page < 2 ? new Cursor({ page: 2 }) : undefined,
  });
  const cache = makeQueryCache();
  const resource = infiniteResource(cache, definition);
  resource.select(new Request({ id: 'one', filter: Option.none() }));
  const loaded = await Effect.runPromise(resource.loadNext());
  expect(loaded.pages.map((page) => page.value)).toEqual(['one:1', 'one:2']);
  const retried = await Effect.runPromise(resource.retryPage(new Cursor({ page: 1 })));
  expect(retried.pages.map((page) => page.value)).toEqual(['one:1', 'one:2']);
  resource.dispose();
  await Effect.runPromise(cache.close());
});

it('uses the captured Effect clock for cache freshness', async () => {
  let loads = 0;
  const definition = query({
    name: 'clock',
    staleTime: 50,
    load: (_id: string) => Effect.sync(() => ++loads),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* scopedQueryCache();
        const resource = queryResource({ cache }, definition);
        resource.select('one');
        expect(loads).toBe(1);
        yield* TestClock.adjust(49);
        resource.select(undefined);
        resource.select('one');
        expect(loads).toBe(1);
        yield* TestClock.adjust(1);
        resource.select(undefined);
        resource.select('one');
        expect(loads).toBe(2);
        resource.dispose();
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});
