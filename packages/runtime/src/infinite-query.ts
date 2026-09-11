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
import { queryResource, type QueryResource } from './session.js';
import { protectSnapshot, type Snapshot } from './snapshot.js';

export interface InfiniteData<A, Param> {
  readonly pages: readonly { readonly param: Param; readonly value: A }[];
  readonly next: Param | undefined;
}
export interface InfiniteQuery<Args, A, Param, E = never, R = never> {
  readonly query: Query<Args, InfiniteData<A, Param>, E, R>;
  readonly page: Query<{ args: Args; param: Param }, A, E, R>;
  readonly maxPages: number;
  readonly next: (value: Snapshot<A>, param: Snapshot<Param>) => Param | undefined;
  readonly paramKey: (param: Param | Snapshot<Param> | undefined) => string;
}
/** Shared pages with explicit cursor identity. Refresh preserves retained page parameters by default. */
export function infiniteQuery<Args, A, Param, E = never, R = never>(
  definition: {
    readonly name: string;
    readonly initial: Param;
    readonly load: (
      args: Snapshot<Args>,
      param: Snapshot<Param>,
    ) => Effect.Effect<A, E, R | Scope.Scope>;
    readonly next: (value: Snapshot<A>, param: Snapshot<Param>) => Param | undefined;
    readonly maxPages?: number;
    readonly refresh?: 'retained' | 'first';
    readonly groups?: readonly QueryGroup[];
    readonly encodeArgs?: (args: Snapshot<Args>) => QueryKey;
    readonly encodeParam?: (param: Snapshot<Param>) => QueryKey;
  } & ([Args] extends [QueryArgs<Args>]
    ? unknown
    : { readonly encodeArgs: (args: Snapshot<Args>) => QueryKey }) &
    ([Param] extends [QueryArgs<Param>]
      ? unknown
      : { readonly encodeParam: (param: Snapshot<Param>) => QueryKey }),
): InfiniteQuery<Args, A, Param, E, R> {
  const config = Object.freeze({ ...definition });
  const maxPages = config.maxPages ?? Infinity;
  if (maxPages !== Infinity && (!Number.isInteger(maxPages) || maxPages < 1))
    throw new RangeError('maxPages must be a positive integer.');
  const encodeArgs = (args: Snapshot<Args>) =>
    config.encodeArgs ? config.encodeArgs(args) : (args as QueryKey);
  const encodeParam = (param: Snapshot<Param>) =>
    config.encodeParam ? config.encodeParam(param) : (param as QueryKey);
  const paramKey = (param: Param | Snapshot<Param> | undefined) =>
    encodeQueryKey(param === undefined ? undefined : encodeParam(param as Snapshot<Param>));
  paramKey(config.initial);
  const initial = protectSnapshot(config.initial) as Snapshot<Param>;
  const next = (value: Snapshot<A>, param: Snapshot<Param>): Param | undefined => {
    const result = config.next(value, param);
    paramKey(result);
    return result;
  };
  const page = query<{ args: Args; param: Param }, A, E, R>({
    name: `${config.name}:page`,
    encode: ({ args, param }: Snapshot<{ args: Args; param: Param }>) => ({
      args: encodeArgs(args),
      param: encodeParam(param),
    }),
    load: ({ args, param }: Snapshot<{ args: Args; param: Param }>) => config.load(args, param),
  });
  const root = query<Args, InfiniteData<A, Param>, E, R>({
    name: config.name,
    encode: encodeArgs,
    ...(config.groups ? { groups: config.groups } : {}),
    load: (args: Snapshot<Args>, previous?: Snapshot<InfiniteData<A, Param>>) => {
      const params =
        config.refresh !== 'first' && previous?.pages.length
          ? previous.pages.map((page) => page.param)
          : [initial];
      return Effect.forEach(params, (param) =>
        config.load(args, param).pipe(Effect.map((value) => ({ param: param as Param, value }))),
      ).pipe(
        Effect.map((pages): InfiniteData<A, Param> => {
          const last = pages[pages.length - 1]!;
          return {
            pages,
            next: next(protectSnapshot(last.value) as Snapshot<A>, last.param as Snapshot<Param>),
          };
        }),
      );
    },
  });
  return Object.freeze({ query: root, page, maxPages, next, paramKey });
}

export interface InfiniteResource<Args, A, Param, E = never> extends QueryResource<
  Args,
  InfiniteData<A, Param>,
  E
> {
  loadNext(): Effect.Effect<Snapshot<InfiniteData<A, Param>>, E>;
  retryPage(param: Param | Snapshot<Param>): Effect.Effect<Snapshot<InfiniteData<A, Param>>, E>;
  seed(
    args: Args | Snapshot<Args>,
    data: InfiniteData<A, Param> | Snapshot<InfiniteData<A, Param>>,
  ): Snapshot<InfiniteData<A, Param>>;
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

/** Cache-owned results, observer-owned subscriptions. Operations return typed Effects for task composition. */
export function infiniteResource<Args, A, Param, E, R>(
  cache: QueryCache<R>,
  definition: InfiniteQuery<Args, A, Param, E, NoInfer<R> | Scope.Scope>,
): InfiniteResource<Args, A, Param, E> {
  const resource = queryResource({ cache }, definition.query);
  const internal = cacheInternals(cache);
  let selected: Args | Snapshot<Args> | undefined;
  let disposed = false;
  const stopReset = cache.onReset(() => {
    selected = undefined;
  });
  const book = operationBook(cache, definition.query);
  const updatePage = (retry?: { param: Param | Snapshot<Param> }) =>
    Effect.gen(function* () {
      if (disposed || selected === undefined) return yield* Effect.interrupt;
      const args = selected;
      const current = yield* cache.prefetch(definition.query, args);
      const param = retry ? retry.param : current.next;
      if (param === undefined) return current;
      const pageKey = definition.paramKey(param);
      const retained = current.pages.some((page) => definition.paramKey(page.param) === pageKey);
      if (retry && !retained && definition.paramKey(current.next) !== pageKey)
        return yield* Effect.die(
          new RangeError('Retry a retained page or the next page parameter.'),
        );
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
        const pageArgs = { args, param } as Snapshot<{ args: Args; param: Param }>;
        const value = yield* cache.prefetch(definition.page, pageArgs, { refresh: true });
        let result: Snapshot<InfiniteData<A, Param>> | undefined;
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
          const index = latest.pages.findIndex(
            (page) => definition.paramKey(page.param) === pageKey,
          );
          if (index < 0 && (retained || definition.paramKey(latest.next) !== pageKey)) return;
          if (index >= 0 && latest.pages[index]!.value === value) return;
          const pages = [...latest.pages];
          const page = { param, value } as Snapshot<{ param: Param; value: A }>;
          if (index >= 0) pages[index] = page;
          else pages.push(page);
          const kept = pages.slice(-definition.maxPages);
          const last = kept[kept.length - 1]!;
          result = cache.setQueryData(definition.query, args, {
            pages: kept,
            next: definition.next(last.value, last.param),
          } as Snapshot<InfiniteData<A, Param>>);
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
  return {
    read: resource.read,
    subscribe: resource.subscribe,
    select(args: Args | Snapshot<Args> | undefined) {
      selected = args;
      resource.select(args);
    },
    refresh: resource.refresh,
    loadNext: () => updatePage(),
    retryPage: (param: Param | Snapshot<Param>) => updatePage({ param }),
    seed(
      args: Args | Snapshot<Args>,
      data: InfiniteData<A, Param> | Snapshot<InfiniteData<A, Param>>,
    ) {
      if (!data.pages.length || data.pages.length > definition.maxPages)
        throw new RangeError('Seed pages must fit the retained page range.');
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
