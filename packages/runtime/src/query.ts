import type { Effect } from 'effect';

/** Canonical data identity: plain objects, dense arrays, and finite scalar values. */
export type QueryKey =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly QueryKey[]
  | { readonly [key: string]: QueryKey };

/** Shared by cache lookup and resource reconciliation. Object property order is irrelevant. */
export function encodeQueryKey(key: QueryKey): string {
  const ancestors = new Set<object>();
  const encode = (value: QueryKey): string => {
    if (value === undefined) return 'u';
    if (value === null) return 'n';
    if (typeof value === 'string') return `s${JSON.stringify(value)}`;
    if (typeof value === 'boolean') return value ? 'b1' : 'b0';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Query keys require finite numbers.');
      return Object.is(value, -0) ? 'd-0' : `d${value}`;
    }
    if (typeof value !== 'object') throw new TypeError('Unsupported query key value.');
    if (ancestors.has(value)) throw new TypeError('Query keys cannot contain cycles.');
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      Array.isArray(value)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new TypeError('Query keys require plain objects and arrays.');
    ancestors.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol'))
        throw new TypeError('Query keys cannot contain symbol properties.');
      for (const [name, descriptor] of Object.entries(descriptors)) {
        if (Array.isArray(value) && name === 'length') continue;
        if (!descriptor.enumerable || !('value' in descriptor))
          throw new TypeError('Query keys require enumerable data properties.');
      }
      if (Array.isArray(value)) {
        if (
          Object.keys(value).length !== value.length ||
          Object.keys(value).some((key, index) => key !== String(index))
        )
          throw new TypeError('Query keys require dense arrays without extra properties.');
        return `a[${value.map(encode).join(',')}]`;
      }
      return `o{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode(descriptors[key]!.value as QueryKey)}`)
        .join(',')}}`;
    } finally {
      ancestors.delete(value);
    }
  };
  return encode(key);
}

let nextQueryId = 0;

export interface Query<Args, A, E = never, R = never> {
  readonly id: number;
  readonly name: string;
  readonly key: (args: Args) => QueryKey;
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
  readonly key: (args: Args) => QueryKey;
  readonly load: (args: Args) => Effect.Effect<A, E, R>;
  readonly staleTime?: number;
  readonly share?: (previous: A, next: A) => A;
}): Query<Args, A, E, R>;
export function query<Args, A, E = never, R = never>(definition: {
  readonly name: string;
  readonly key?: (args: Args) => QueryKey;
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
