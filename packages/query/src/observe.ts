import type * as Scope from 'effect/Scope';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import type { DisposableOwner, Snapshot, Source } from 'effectweb';
import { reportError, reportSafely } from './errors.js';
import { encodeQueryArguments, type Query } from './query.js';
import type { QueryCache } from './cache.js';
import { cacheInternals } from './cache-internals.js';
import type { InfiniteData, InfiniteQuery } from './infinite-query.js';

/** One owned selection and immutable observation of a shared query resource. */
export interface QueryResource<Args, A, E = never> {
  select(this: void, args: Args | Snapshot<Args> | undefined): void;
  read(this: void): AsyncResult.AsyncResult<Snapshot<A>, E>;
  subscribe(
    this: void,
    listener: (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void,
  ): () => void;
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
  let atom: Atom.Atom<AsyncResult.AsyncResult<Snapshot<A>, E>> | undefined;
  let stop: (() => void) | undefined;
  let disposed = false;
  let revision = 0;
  const initial = AsyncResult.initial<Snapshot<A>, E>();
  const listeners = new Set<(result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void>();
  const read = () =>
    atom &&
    !disposed &&
    !internal.disposed() &&
    generation === internal.registry.get(internal.generation)
      ? internal.registry.get(atom)
      : initial;
  let published: AsyncResult.AsyncResult<Snapshot<A>, E> | undefined;
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
  // Initialize before subscribing; construction must not invoke application callbacks.
  internal.registry.get(internal.generation);
  const stopGeneration = internal.registry.subscribe(internal.generation, () => {
    revision++;
    disconnect();
    atom = undefined;
    key = undefined;
    generation = -1;
    notify();
  });
  return {
    select(args: Args | Snapshot<Args> | undefined) {
      if (disposed || internal.disposed()) return;
      const nextGeneration = internal.registry.get(internal.generation);
      const nextKey = args === undefined ? undefined : encodeQueryArguments(definition, args);
      if (nextKey === key && nextGeneration === generation) return;
      const selected = ++revision;
      disconnect();
      // Releasing the previous query can run finalizers that select or dispose again.
      if (disposed || selected !== revision) return;
      key = nextKey;
      generation = nextGeneration;
      const nextAtom = args === undefined ? undefined : internal.query(definition, args);
      if (disposed || selected !== revision) return;
      atom = nextAtom;
      if (nextAtom) {
        // Subscription setup itself can execute a synchronous Effect and reenter selection.
        const releaseUse = internal.retain(nextAtom);
        const unsubscribe = internal.registry.subscribe(nextAtom, notify);
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
    subscribe(listener: (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => {
      if (
        atom &&
        !disposed &&
        !internal.disposed() &&
        generation === internal.registry.get(internal.generation) &&
        !internal.registry.get(atom).waiting
      )
        internal.refresh(atom);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      revision++;
      listeners.clear();
      stopGeneration();
      disconnect();
      atom = undefined;
      key = undefined;
    },
  };
}

export function observeQuery<Args, A, E, R>(
  owner: DisposableOwner,
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  changed: (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void,
): QueryResource<Args, A, E> {
  const resource = queryResource({ cache }, definition);
  resource.subscribe(changed);
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
  args: Args | Snapshot<Args>,
): Source<AsyncResult.AsyncResult<Snapshot<InfiniteData<A, Param>>, E>>;
export function querySource<Args, A, E, R>(
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  args: Args | Snapshot<Args>,
): Source<AsyncResult.AsyncResult<Snapshot<A>, E>>;
export function querySource<Args, A, E, R>(
  cache: QueryCache<R>,
  requested:
    | Query<Args, A, E, NoInfer<R> | Scope.Scope>
    | { readonly query: Query<Args, A, E, NoInfer<R> | Scope.Scope> },
  args: Args | Snapshot<Args>,
): Source<AsyncResult.AsyncResult<Snapshot<A>, E>> {
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
  if (existing) return existing as Source<AsyncResult.AsyncResult<Snapshot<A>, E>>;
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
  const source: Source<AsyncResult.AsyncResult<Snapshot<A>, E>> = {
    model: () => {
      const read = acquire().read();
      if (!observers) releaseIfUnobserved();
      return read as Snapshot<AsyncResult.AsyncResult<Snapshot<A>, E>>;
    },
    subscribe(listener) {
      observers++;
      const stop = acquire().subscribe(
        listener as (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void,
      );
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
