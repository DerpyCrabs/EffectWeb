import type { Effect } from 'effect';

let nextQueryId = 0;

/** One logical read. Share its definition between consumers, prefetching and mutations. */
export interface Query<Args, A, E = never, R = never> {
  readonly id: number;
  readonly name: string;
  readonly key: (args: Args) => string;
  readonly load: (args: Args) => Effect.Effect<A, E, R>;
  /** Revalidate on activation/prefetch after this many milliseconds. No polling timer. */
  readonly staleTime: number;
  /** Reuse unchanged domain entities before publishing a refreshed result. */
  readonly share?: (previous: A, next: A) => A;
}

/** Identity belongs to arguments, never callback identity. Separate caches isolate independent data scopes. */
export function query<A, E = never, R = never>(definition: {
  readonly name: string;
  readonly load: () => Effect.Effect<A, E, R>;
  readonly staleTime?: number;
  readonly share?: (previous: A, next: A) => A;
}): Query<true, A, E, R>;
export function query<Args, A, E = never, R = never>(definition: {
  readonly name: string;
  readonly key: (args: Args) => string;
  readonly load: (args: Args) => Effect.Effect<A, E, R>;
  readonly staleTime?: number;
  readonly share?: (previous: A, next: A) => A;
}): Query<Args, A, E, R>;
export function query<Args, A, E = never, R = never>(definition: {
  readonly name: string;
  readonly key?: (args: Args) => string;
  readonly load: (args: Args) => Effect.Effect<A, E, R>;
  /** Defaults to explicit invalidation, while unused values retain the cache's 30 second TTL. */
  readonly staleTime?: number;
  readonly share?: (previous: A, next: A) => A;
}): Query<Args, A, E, R> {
  const staleTime = definition.staleTime ?? Infinity;
  if (Number.isNaN(staleTime) || staleTime < 0)
    throw new RangeError('Query staleTime must be nonnegative.');
  return Object.freeze({
    ...definition,
    key: definition.key ?? (() => ''),
    id: ++nextQueryId,
    staleTime,
  });
}
