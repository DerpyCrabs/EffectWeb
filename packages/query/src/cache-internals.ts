import type * as Scope from 'effect/Scope';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import type { QueryCache } from './cache.js';
import type { Query } from './query.js';
import { type Snapshot } from 'effectweb';

declare const entryType: unique symbol;
/** One cached query resource, readable and observable through the cache internals. */
export interface QueryEntry<A, E> {
  readonly [entryType]?: { readonly value: A; readonly error: E };
}

export interface CacheInternals<R> {
  readonly disposed: () => boolean;
  refresh(entry: QueryEntry<unknown, unknown>): void;
  revision<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: Args | Snapshot<Args>,
  ): number | undefined;
  retain(entry: QueryEntry<unknown, unknown>): () => void;
  /** Current result; a stale or unstarted entry starts loading. */
  read<A, E>(entry: QueryEntry<A, E>): AsyncResult.AsyncResult<Snapshot<A>, E>;
  subscribe(entry: QueryEntry<unknown, unknown>, listener: () => void): () => void;
  /** Account generation; every reset invalidates earlier selections. */
  readonly generation: () => number;
  onGeneration(listener: () => void): () => void;
  query<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: Args | Snapshot<Args>,
  ): QueryEntry<A, E>;
}
const caches = new WeakMap<object, unknown>();
export function registerCache<R>(cache: QueryCache<R>, internals: CacheInternals<R>): void {
  caches.set(cache, internals);
}
/** Private implementation access; deliberately absent from package exports. */
export function cacheInternals<R>(cache: QueryCache<R>): CacheInternals<R> {
  const internals = caches.get(cache);
  if (!internals) throw new TypeError('Use makeQueryCache() to create a cache.');
  return internals as CacheInternals<R>;
}
