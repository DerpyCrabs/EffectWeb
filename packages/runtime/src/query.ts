import type { Effect } from 'effect';
import { registerQuery, type QueryDefinition } from './query-internals.js';

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

/** Data-only request arguments. Services belong in the Effect environment. */
export type QueryArgs<A> = A extends string | number | boolean | null | undefined
  ? A
  : A extends (...args: never[]) => unknown
    ? never
    : A extends object
      ? { readonly [K in keyof A]: K extends symbol ? never : QueryArgs<A[K]> }
      : never;

declare const queryType: unique symbol;
/** An opaque typed definition. Every request argument participates in cache identity. */
export interface Query<Args, A, E = never, R = never> {
  readonly name: string;
  readonly [queryType]: (args: Args) => Effect.Effect<A, E, R>;
}

type Definition<Args, A, E, R> = Omit<QueryDefinition<Args, A, E, R>, 'staleTime'> & {
  readonly staleTime?: number;
  /** Custom projections can silently reuse a different request's result. */
  readonly key?: never;
};

export function query<Args, A, E = never, R = never>(
  definition: Definition<Args, A, E, R> &
    (Args extends QueryArgs<Args> ? unknown : { readonly nonSerializableQueryArguments: never }),
): Query<Args, A, E, R>;
export function query<A, E = never, R = never>(
  definition: Definition<true, A, E, R> & { readonly load: () => Effect.Effect<A, E, R> },
): Query<true, A, E, R>;
export function query<Args, A, E = never, R = never>(
  definition: Definition<Args, A, E, R>,
): Query<Args, A, E, R> {
  if ('key' in definition)
    throw new TypeError(
      'Query identity includes all arguments. Remove key and provide services through the Effect environment.',
    );
  const staleTime = definition.staleTime ?? Infinity;
  if (Number.isNaN(staleTime) || staleTime < 0)
    throw new RangeError('Query staleTime must be nonnegative.');
  const result = Object.freeze({ name: definition.name }) as Query<Args, A, E, R>;
  registerQuery(
    result,
    Object.freeze({
      ...definition,
      ...(definition.groups ? { groups: Object.freeze([...definition.groups]) } : {}),
      staleTime,
    }),
  );
  return result;
}

declare const groupType: unique symbol;
export type QueryGroup = symbol & { readonly [groupType]: true };
/** Invalidation identity; equal diagnostic names do not share membership. */
export const queryGroup = (name: string): QueryGroup => Symbol(name) as QueryGroup;
