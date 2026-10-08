import type * as Scope from 'effect/Scope';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import type { DisposableOwner, ModelOwner, Source } from 'effectweb';
import { reportError, reportSafely } from './errors.js';
import { encodeQueryArguments, type Query } from './query.js';
import type { QueryCache } from './cache.js';
import { cacheInternals, type QueryEntry } from './cache-internals.js';
import type { InfiniteData, InfiniteQuery } from './infinite-query.js';

/** One owned selection and immutable observation of a shared query resource. */
export interface QueryResource<Args, A, E = never> {
  select(this: void, args: Args | undefined): void;
  read(this: void): AsyncResult.AsyncResult<A, E>;
  subscribe(this: void, listener: (result: AsyncResult.AsyncResult<A, E>) => void): () => void;
  refresh(this: void): void;
  dispose(this: void): void;
}

/**
 * Idempotent query reconciliation for snapshot ticks. Freshness is checked when entering a
 * selection (including remount), not on every same-key tick; refresh revalidates unless a request is already in flight.
 */
export function queryResource<Args, A, E, R>(
  context: { cache: QueryCache<R>; changed?: () => void },
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
): QueryResource<Args, A, E> {
  const internal = cacheInternals(context.cache);
  let key: string | undefined;
  let generation = -1;
  let entry: QueryEntry<A, E> | undefined;
  let stop: (() => void) | undefined;
  let disposed = false;
  let revision = 0;
  const initial = AsyncResult.initial<A, E>();
  const listeners = new Set<(result: AsyncResult.AsyncResult<A, E>) => void>();
  const read = () =>
    entry && !disposed && !internal.disposed() && generation === internal.generation()
      ? internal.read(entry)
      : initial;
  let published: AsyncResult.AsyncResult<A, E> | undefined;
  let notifying = false;
  let pending = false;
  const call = (work: () => void) => {
    try {
      work();
    } catch (error) {
      reportSafely(reportError, error);
    }
  };
  const notify = () => {
    if (disposed) return;
    pending = true;
    if (notifying) return;
    notifying = true;
    try {
      while (pending && !disposed) {
        pending = false;
        if (context.changed) call(context.changed);
        if (disposed) break;
        const result = read();
        if (result === published) continue;
        published = result;
        const selected = revision;
        // A callback may select, reset, refresh or dispose. Finish only the current publication.
        // oxlint-disable-next-line unicorn/no-useless-spread -- Iterate a snapshot because listeners can add or remove subscriptions.
        for (const listener of [...listeners]) {
          if (disposed || selected !== revision || result !== read()) break;
          if (listeners.has(listener)) call(() => listener(result));
        }
      }
    } finally {
      notifying = false;
    }
  };
  const disconnect = () => {
    const release = stop;
    stop = undefined;
    release?.();
  };
  const stopGeneration = internal.onGeneration(() => {
    revision++;
    disconnect();
    entry = undefined;
    key = undefined;
    generation = -1;
    notify();
  });
  return {
    select(args: Args | undefined) {
      if (disposed || internal.disposed()) return;
      const nextGeneration = internal.generation();
      const nextKey = args === undefined ? undefined : encodeQueryArguments(definition, args);
      if (nextKey === key && nextGeneration === generation) return;
      const selected = ++revision;
      disconnect();
      // Releasing the previous query can run finalizers that select or dispose again.
      if (disposed || selected !== revision) return;
      key = nextKey;
      generation = nextGeneration;
      const next = args === undefined ? undefined : internal.query(definition, args);
      if (disposed || selected !== revision) return;
      entry = next;
      if (next) {
        // Subscription setup itself can execute a synchronous Effect and reenter selection.
        const releaseUse = internal.retain(next);
        const unsubscribe = internal.subscribe(next, notify);
        const release = () => {
          unsubscribe();
          releaseUse();
        };
        if (disposed || selected !== revision) {
          release();
          return;
        }
        stop = release;
      }
      notify();
    },
    read,
    subscribe(listener: (result: AsyncResult.AsyncResult<A, E>) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => {
      if (
        entry &&
        !disposed &&
        !internal.disposed() &&
        generation === internal.generation() &&
        !internal.read(entry).waiting
      )
        internal.refresh(entry);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      revision++;
      listeners.clear();
      stopGeneration();
      disconnect();
      entry = undefined;
      key = undefined;
    },
  };
}

type ResultKeys<Model, A, E> = {
  [K in keyof Model]: AsyncResult.AsyncResult<A, E> extends Model[K] ? K : never;
}[keyof Model];

/** Observe a query and publish each result through `changed`. */
export function observeQuery<Args, A, E, R>(
  owner: DisposableOwner,
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  changed: (result: AsyncResult.AsyncResult<A, E>) => void,
): QueryResource<Args, A, E>;
/** Observe a query and patch each result into the owner's model at `key`. */
export function observeQuery<Model extends object, Args, A, E, R>(
  owner: ModelOwner<Model>,
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  key: ResultKeys<Model, A, E>,
): QueryResource<Args, A, E>;
/** Observe a query and patch `project(result)` into the owner's model at `key`. */
export function observeQuery<Model extends object, K extends keyof Model, Args, A, E, R>(
  owner: ModelOwner<Model>,
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  key: K,
  project: (result: AsyncResult.AsyncResult<A, E>) => Model[K],
): QueryResource<Args, A, E>;
export function observeQuery<Model extends object, Args, A, E, R>(
  owner: DisposableOwner | ModelOwner<Model>,
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  target: ((result: AsyncResult.AsyncResult<A, E>) => void) | keyof Model,
  project?: (result: AsyncResult.AsyncResult<A, E>) => unknown,
): QueryResource<Args, A, E> {
  const resource = queryResource({ cache }, definition);
  if (typeof target === 'function') resource.subscribe(target);
  else {
    const { patch } = owner as ModelOwner<Model>;
    resource.subscribe((result) =>
      patch({ [target]: project ? project(result) : result } as Partial<Model>),
    );
  }
  return owner.own(resource);
}

type SharedSource = Source<AsyncResult.AsyncResult<unknown, unknown>>;
const sources = new WeakMap<QueryCache<never>, Map<object, Map<string, SharedSource>>>();

/**
 * A query as a view source: `observe(querySource(cache, userQuery, { id }), render)`.
 * Equal arguments return the same source, so a view can call this while rendering.
 * The query loads while observed and is released when its last observer leaves.
 */
export function querySource<Args, A, Param, E, R>(
  cache: QueryCache<R>,
  definition: InfiniteQuery<Args, A, Param, E, NoInfer<R> | Scope.Scope>,
  args: Args,
): Source<AsyncResult.AsyncResult<InfiniteData<A, Param>, E>>;
export function querySource<Args, A, E, R>(
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  args: Args,
): Source<AsyncResult.AsyncResult<A, E>>;
export function querySource<Args, A, E, R>(
  cache: QueryCache<R>,
  requested:
    | Query<Args, A, E, NoInfer<R> | Scope.Scope>
    | { readonly query: Query<Args, A, E, NoInfer<R> | Scope.Scope> },
  args: Args,
): Source<AsyncResult.AsyncResult<A, E>> {
  // An infinite query is read through its aggregate query of retained pages.
  const definition =
    'query' in requested && 'page' in requested
      ? requested.query
      : (requested as Query<Args, A, E, NoInfer<R> | Scope.Scope>);
  const key = encodeQueryArguments(definition, args);
  let byQuery = sources.get(cache as QueryCache<never>);
  if (!byQuery)
    sources.set(
      cache as QueryCache<never>,
      (byQuery = new Map<object, Map<string, SharedSource>>()),
    );
  let byKey = byQuery.get(definition);
  if (!byKey) byQuery.set(definition, (byKey = new Map<string, SharedSource>()));
  const existing = byKey.get(key);
  if (existing) return existing as Source<AsyncResult.AsyncResult<A, E>>;
  const entries = byKey;
  let resource: QueryResource<Args, A, E> | undefined;
  let observers = 0;
  const acquire = () => {
    if (!resource) {
      resource = queryResource({ cache }, definition);
      resource.select(args);
    }
    return resource;
  };
  // A read without an observer (or the last observer leaving) releases after the current turn,
  // so the subscription that normally follows a first read keeps the same resource.
  const releaseIfUnobserved = () =>
    queueMicrotask(() => {
      if (observers || !resource) return;
      resource.dispose();
      resource = undefined;
      if (entries.get(key) === source) entries.delete(key);
    });
  const source: Source<AsyncResult.AsyncResult<A, E>> = {
    model: () => {
      const read = acquire().read();
      if (!observers) releaseIfUnobserved();
      return read as AsyncResult.AsyncResult<A, E>;
    },
    subscribe(listener) {
      observers++;
      const stop = acquire().subscribe(listener as (result: AsyncResult.AsyncResult<A, E>) => void);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        stop();
        if (!--observers) releaseIfUnobserved();
      };
    },
  };
  entries.set(key, source as SharedSource);
  return source;
}
