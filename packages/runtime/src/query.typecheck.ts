import { Effect } from 'effect';
import { query, type Query } from './query.js';
import { makeQueryCache } from './cache.js';
import { queryResource } from './session.js';
import type { Snapshot } from './snapshot.js';

export function queryTypes() {
  interface Filter {
    id: string;
    nested: { status: string; tags?: readonly string[] };
  }
  const data = query<Filter, string>({
    name: 'data',
    load: (args) => Effect.succeed(args.nested.status),
  });
  const cache = makeQueryCache();
  const valid = cache.prefetch(data, { id: 'a', nested: { status: 'open' } });
  const projected = {
    name: 'bad',
    key: (args: Filter) => args.id,
    load: (args: Filter) => Effect.succeed(args.nested.status),
  };
  // @ts-expect-error Complete request arguments cannot be replaced by a custom projection.
  const invalidProjection = query(projected);
  void invalidProjection;
  // @ts-expect-error Services are not serializable request arguments.
  query({ name: 'service', load: (args: { api: () => string }) => Effect.succeed(args.api()) });
  // @ts-expect-error Date is not plain request data; pass an explicit timestamp.
  query({ name: 'date', load: (args: { date: Date }) => Effect.succeed(args.date.getTime()) });
  // @ts-expect-error Definitions cannot be constructed with a caller-selected identity or load type.
  const forged: Query<true, string> = { name: 'data', id: 1, load: () => Effect.succeed('bad') };
  // @ts-expect-error A query's result type is established once at definition.
  const incompatible: Query<Filter, number> = data;
  void [forged, incompatible];
  return valid;
}

export function querySnapshotArguments() {
  type Args = { ids: string[]; filters: { tags: string[] }[] };
  const data = query<Args, { names: string[] }>({
    name: 'readonly-arguments',
    load: (args) => {
      // @ts-expect-error Query loaders borrow immutable array arguments.
      // oxlint-disable-next-line typescript/no-unsafe-call -- Negative readonly contract.
      args.ids.push('bad');
      return Effect.succeed({ names: args.ids.slice() });
    },
  });
  const cache = makeQueryCache();
  const args: Snapshot<Args> = { ids: ['a'], filters: [{ tags: ['open'] }] };
  const resource = queryResource({ cache }, data);
  resource.select(args);
  cache.invalidateQuery(data, args);
  const fetched = cache.prefetch(data, args);
  const value: Snapshot<{ names: string[] }> = { names: ['Ada'] };
  const written = cache.setQueryData(data, args, value);
  cache.updateQueryData(data, args, (previous) => {
    // @ts-expect-error Updaters borrow immutable published values.
    // oxlint-disable-next-line typescript/no-unsafe-call -- Negative readonly contract.
    previous.names.push('bad');
    return { names: [...previous.names, 'Grace'] };
  });
  // @ts-expect-error Writes return immutable snapshots.
  // oxlint-disable-next-line typescript/no-unsafe-call -- Negative readonly contract.
  written.names.push('bad');
  // @ts-expect-error The definition fixes the result type; a writer cannot widen it.
  cache.setQueryData(data, args, { names: [1] });
  // @ts-expect-error Update results must match the definition.
  cache.updateQueryData(data, args, () => ({ names: [1] }));
  // @ts-expect-error A wider updater input cannot widen the query's stored result.
  cache.updateQueryData(data, args, (_previous: unknown) => ({ names: [1] }));
  // @ts-expect-error The definition fixes argument types for prefetch.
  const invalidPrefetch = cache.prefetch(data, { ids: [1], filters: [] });
  void invalidPrefetch;
  // @ts-expect-error The definition fixes argument types for writes.
  cache.setQueryData(data, { ids: [1], filters: [] }, value);
  // @ts-expect-error Defined string arrays cannot be replaced by undefined data.
  cache.setQueryData(data, args, undefined);
  resource.dispose();
  cache.dispose();
  const arrayQuery = query<string[], number>({
    name: 'array',
    load: (ids) => Effect.succeed(ids.length),
  });
  const arrayCache = makeQueryCache();
  const readonlyIds: readonly string[] = ['a'];
  queryResource({ cache: arrayCache }, arrayQuery).select(readonlyIds);
  const arrayResult = arrayCache.prefetch(arrayQuery, readonlyIds);
  arrayCache.invalidateQuery(arrayQuery, readonlyIds);
  arrayCache.setQueryData(arrayQuery, readonlyIds, 1);
  // @ts-expect-error An array argument does not erase its element type.
  const invalidArray = arrayCache.prefetch(arrayQuery, [1]);
  arrayCache.dispose();
  void [arrayResult, invalidArray];
  return fetched;
}
