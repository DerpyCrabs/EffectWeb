import { shareValue } from './share.js';
export type Identity = string | number;

/** Identity belongs to the domain collection, not to each place that renders it. */
export interface Rows<A> {
  readonly items: readonly A[];
  readonly identity: (item: A, index: number) => Identity;
  readonly length: number;
  map<B>(render: (item: A, index: number) => B): B[];
  filter(predicate: (item: A, index: number) => boolean): Rows<A>;
  slice(start?: number, end?: number): Rows<A>;
}

export function collection<A>(identity: (item: A, index: number) => Identity) {
  const cache = new WeakMap<readonly A[], Rows<A>>();
  const comparisons = new WeakMap<readonly A[], WeakMap<readonly A[], readonly A[]>>();
  const from = (items: readonly A[]): Rows<A> => {
    const cached = cache.get(items);
    if (cached) return cached;
    const rows: Rows<A> = {
      items,
      identity,
      length: items.length,
      map: (render) => items.map(render),
      filter: (predicate) => from(items.filter(predicate)),
      slice: (start, end) => from(items.slice(start, end)),
    };
    cache.set(items, rows);
    return rows;
  };
  /** Reconcile immutable items before projections, using the same identity as rendered rows. */
  function share<B extends A>(previous: readonly B[], next: B[]): B[];
  function share<B extends A>(previous: readonly B[], next: readonly B[]): readonly B[];
  function share<B extends A>(previous: readonly B[], next: readonly B[]): readonly B[] {
    if (previous === next) return previous;
    let pairs = comparisons.get(previous);
    const cached = pairs?.get(next);
    if (cached) return cached as readonly B[];
    let byIdentity: Map<Identity, B> | undefined;
    let result: B[] | undefined;
    let equal = previous.length === next.length;
    for (let index = 0; index < next.length; index++) {
      const item = next[index]!;
      if (index < previous.length && Object.is(previous[index], item)) continue;
      const key = identity(item, index);
      let old = previous[index];
      if (index >= previous.length || !Object.is(identity(old!, index), key)) {
        if (!byIdentity) {
          byIdentity = new Map(previous.map((value, i) => [identity(value, i), value]));
          const keys = next.map(identity);
          if (byIdentity.size !== previous.length || new Set(keys).size !== keys.length)
            throw new Error(
              'Duplicate collection identity. Identity must be unique within the collection.',
            );
        }
        old = byIdentity.get(key);
      }
      const value = old === undefined ? item : shareValue(old, item);
      if (!Object.is(value, previous[index])) equal = false;
      if (!Object.is(value, item) && !result) result = next.slice();
      if (result) result[index] = value;
    }
    const shared = equal ? previous : (result ?? next);
    if (!pairs) {
      pairs = new WeakMap();
      comparisons.set(previous, pairs);
    }
    pairs.set(next, shared);
    return shared;
  }
  return { from, share };
}

const positions = collection<unknown>((_item, index) => index);
/** Use positional identity for ordered values without stable entity IDs. */
export function sequence<A>(items: readonly A[]): Rows<A> {
  return positions.from(items) as Rows<A>;
}

const empty: readonly never[] = [];
const identified = collection<{ readonly id: Identity }>((item) => item.id);
/** Rows keyed by their domain IDs. Reuses the wrapper for the same immutable array. */
export function entities<A extends { readonly id: Identity }>(
  items: readonly A[] | undefined,
): Rows<A> {
  // The collection retains, filters and slices supplied items; it never inserts wider values.
  return identified.from(items ?? empty) as unknown as Rows<A>;
}
