import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import {
  query,
  encodeQueryKey,
  encodeQueryArguments,
  type Query,
  type QueryKey,
  type QueryArgs,
  type QueryGroup,
} from './query.js';
import type { QueryCache } from './cache.js';
import { cacheInternals } from './cache-internals.js';
import { queryResource, type QueryResource } from './observe.js';
import { protectSnapshot } from 'effectweb/advanced';

export interface InfiniteData<A, Param> {
  readonly pages: readonly { readonly param: Param; readonly value: A }[];
  readonly next: Param | undefined;
}
export interface InfiniteQuery<Args, A, Param, E = never, R = never> {
  readonly query: Query<Args, InfiniteData<A, Param>, E, R>;
  readonly page: Query<{ args: Args; param: Param }, A, E, R>;
  readonly next: (value: A, param: Param) => Param | undefined;
  readonly paramKey: (param: Param | undefined) => string;
}
/** Shared pages with explicit cursor identity. Refresh preserves retained page parameters by default. */
export function infiniteQuery<Args, A, Param, E = never, R = never>(
  definition: {
    readonly name: string;
    readonly initial: Param;
    readonly load: (args: Args, param: Param) => Effect.Effect<A, E, R | Scope.Scope>;
    readonly next: (value: A, param: Param) => Param | undefined;
    readonly refresh?: 'retained' | 'first';
    readonly groups?: readonly QueryGroup[];
    /** Freshness applies to both the aggregate and individual page queries. */
    readonly staleTime?: number;
    readonly unused?: 'retain' | 'cancel';
    readonly encodeArgs?: (args: Args) => QueryKey;
    readonly encodeParam?: (param: Param) => QueryKey;
  } & ([Args] extends [QueryArgs<Args>]
    ? unknown
    : { readonly encodeArgs: (args: Args) => QueryKey }) &
    ([Param] extends [QueryArgs<Param>]
      ? unknown
      : { readonly encodeParam: (param: Param) => QueryKey }),
): InfiniteQuery<Args, A, Param, E, R> {
  const config = Object.freeze({ ...definition });
  const encodeArgs = (args: Args) =>
    config.encodeArgs ? config.encodeArgs(args) : (args as QueryKey);
  const encodeParam = (param: Param) =>
    config.encodeParam ? config.encodeParam(param) : (param as QueryKey);
  const paramKey = (param: Param | undefined) =>
    encodeQueryKey(param === undefined ? undefined : encodeParam(param as Param));
  paramKey(config.initial);
  const initial = protectSnapshot(config.initial) as Param;
  const next = (value: A, param: Param): Param | undefined => {
    const result = config.next(value, param);
    paramKey(result);
    return result;
  };
  const page = query<{ args: Args; param: Param }, A, E, R>({
    name: `${config.name}:page`,
    ...(config.staleTime !== undefined ? { staleTime: config.staleTime } : {}),
    ...(config.unused ? { unused: config.unused } : {}),
    encode: ({ args, param }: { args: Args; param: Param }) => ({
      args: encodeArgs(args),
      param: encodeParam(param),
    }),
    load: ({ args, param }: { args: Args; param: Param }) => config.load(args, param),
  });
  const root = query<Args, InfiniteData<A, Param>, E, R>({
    name: config.name,
    encode: encodeArgs,
    ...(config.groups ? { groups: config.groups } : {}),
    ...(config.staleTime !== undefined ? { staleTime: config.staleTime } : {}),
    ...(config.unused ? { unused: config.unused } : {}),
    load: (args: Args, previous?: InfiniteData<A, Param>) => {
      const params =
        config.refresh !== 'first' && previous?.pages.length
          ? previous.pages.map((page) => page.param)
          : [initial];
      return Effect.forEach(params, (param) =>
        config.load(args, param).pipe(Effect.map((value) => ({ param: param as Param, value }))),
      ).pipe(
        Effect.map((pages): InfiniteData<A, Param> => {
          const last = pages[pages.length - 1]!;
          return { pages, next: next(protectSnapshot(last.value) as A, last.param as Param) };
        }),
      );
    },
  });
  return Object.freeze({ query: root, page, next, paramKey });
}

export interface InfiniteResource<Args, A, Param, E = never> extends QueryResource<
  Args,
  InfiniteData<A, Param>,
  E
> {
  /** Load the next page of the selected arguments, as `fetchNextPage(cache, query, args)` does. */
  fetchNextPage(): Effect.Effect<InfiniteData<A, Param>, E>;
  seed(args: Args, data: InfiniteData<A, Param>): InfiniteData<A, Param>;
}

type PageOperation = { revision: number | undefined; active: number };
const operations = new WeakMap<object, WeakMap<object, Map<string, PageOperation>>>();
function operationBook(cache: object, definition: object): Map<string, PageOperation> {
  let definitions = operations.get(cache);
  if (!definitions) {
    definitions = new WeakMap();
    operations.set(cache, definitions);
  }
  let book = definitions.get(definition);
  if (!book) {
    book = new Map();
    definitions.set(definition, book);
  }
  return book;
}

/**
 * Load the page after the last retained page for these arguments. Works from event handlers
 * and commands; the aggregate query must already be loaded or loadable.
 */
function loadPage<Args, A, Param, E, R>(
  cache: QueryCache<R>,
  definition: InfiniteQuery<Args, A, Param, E, NoInfer<R> | Scope.Scope>,
  args: Args,
): Effect.Effect<InfiniteData<A, Param>, E> {
  const internal = cacheInternals(cache);
  const book = operationBook(cache, definition.query);
  return Effect.gen(function* () {
    const current = yield* cache.prefetch(definition.query, args);
    const param = current.next;
    if (param === undefined) return current;
    const pageKey = definition.paramKey(param);
    const retained = current.pages.some((page) => definition.paramKey(page.param) === pageKey);
    const key = encodeQueryArguments(definition.query, args);
    const revision = internal.revision(definition.query, args);
    let operation = book.get(key);
    if (!operation || operation.revision !== revision) {
      operation = { revision, active: 0 };
      book.set(key, operation);
    }
    const state = operation;
    state.active++;
    return yield* Effect.gen(function* () {
      const pageArgs = { args, param } as { args: Args; param: Param };
      const value = yield* cache.prefetch(definition.page, pageArgs, { refresh: true });
      let result: InfiniteData<A, Param> | undefined;
      cache.batch(() => {
        const latest = cache.getQueryData(definition.query, args);
        result = latest;
        // Other page operations can merge. External refresh, writes and reset own a new revision.
        if (
          !latest ||
          book.get(key) !== state ||
          state.revision !== internal.revision(definition.query, args)
        )
          return;
        const index = latest.pages.findIndex((page) => definition.paramKey(page.param) === pageKey);
        if (index < 0 && (retained || definition.paramKey(latest.next) !== pageKey)) return;
        if (index >= 0 && latest.pages[index]!.value === value) return;
        const pages = [...latest.pages];
        const page = { param, value } as { param: Param; value: A };
        if (index >= 0) pages[index] = page;
        else pages.push(page);
        const last = pages[pages.length - 1]!;
        result = cache.setQueryData(definition.query, args, {
          pages,
          next: definition.next(last.value, last.param),
        } as InfiniteData<A, Param>);
        state.revision = internal.revision(definition.query, args);
      });
      return result ?? (yield* Effect.interrupt);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          state.active--;
          if (state.active === 0 && book.get(key) === state) book.delete(key);
        }),
      ),
    );
  });
}

/** Load the next page of an infinite query into the cache. */
export const fetchNextPage = <Args, A, Param, E, R>(
  cache: QueryCache<R>,
  definition: InfiniteQuery<Args, A, Param, E, NoInfer<R> | Scope.Scope>,
  args: Args,
): Effect.Effect<InfiniteData<A, Param>, E> => loadPage(cache, definition, args);

/** Cache-owned results, observer-owned subscriptions. Operations return typed Effects for task composition. */
export function infiniteResource<Args, A, Param, E, R>(
  cache: QueryCache<R>,
  definition: InfiniteQuery<Args, A, Param, E, NoInfer<R> | Scope.Scope>,
): InfiniteResource<Args, A, Param, E> {
  const resource = queryResource({ cache }, definition.query);
  let selected: Args | undefined;
  let disposed = false;
  const stopReset = cacheInternals(cache).onGeneration(() => {
    selected = undefined;
  });
  return {
    read: resource.read,
    subscribe: resource.subscribe,
    select(args: Args | undefined) {
      selected = args;
      resource.select(args);
    },
    refresh: resource.refresh,
    fetchNextPage: () =>
      Effect.suspend(() =>
        disposed || selected === undefined
          ? Effect.interrupt
          : loadPage(cache, definition, selected),
      ),
    seed(args: Args, data: InfiniteData<A, Param>) {
      if (!data.pages.length) throw new RangeError('Seed at least one page.');
      definition.paramKey(data.next);
      const keys = data.pages.map((page) => definition.paramKey(page.param));
      if (new Set(keys).size !== keys.length)
        throw new TypeError('Seed page parameters must be unique.');
      return cache.setQueryData(definition.query, args, data);
    },
    dispose() {
      disposed = true;
      selected = undefined;
      stopReset();
      resource.dispose();
    },
  };
}
