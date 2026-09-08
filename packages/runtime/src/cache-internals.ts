import type * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import type * as Atom from 'effect/unstable/reactivity/Atom';
import type * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';
import type { QueryCache } from './cache.js';
import type { Query } from './query.js';
import type { Snapshot } from './snapshot.js';

export interface CacheInternals<R> {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly generation: Atom.Writable<number>;
  query<Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: Args | Snapshot<Args>,
  ): Atom.Atom<AsyncResult.AsyncResult<Snapshot<A>, E>>;
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
