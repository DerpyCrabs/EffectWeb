import { shareData } from './sharing.js';
export type Identity = string | number;

export interface Rows<A> {
  readonly items: readonly A[];
  readonly identity: (item: A, index: number) => Identity;
  readonly length: number;
  /** Set by collection helpers whose rows were checked for duplicate identities. */
  readonly validated?: true;
  filter(predicate: (item: A, index: number) => boolean): Rows<A>;
  slice(start?: number, end?: number): Rows<A>;
}

// Keys are retained only with their immutable rows; custom Rows still validate at render time.
const rowIdentities = new WeakMap<object, readonly Identity[]>();
export function identitiesOf<A>(rows: Rows<A>): readonly Identity[] {
  return (
    rowIdentities.get(rows) ??
    (rows.validated
      ? Array.from(rows.items, (item, index) => rows.identity(item, index))
      : validateIdentities(rows.items, (item, index) => rows.identity(item, index)))
  );
}

/** Validate without retaining values. Positions are zero-based array indices. */
export function validateIdentities<A, K>(
  items: readonly A[],
  identity: (item: A, index: number) => K,
): K[] {
  const seen = new Map<K, number>();
  return Array.from(items, (item, index) => {
    const key = identity(item, index);
    const previous = seen.get(key);
    if (previous !== undefined)
      throw new Error(
        `Duplicate collection identity ${JSON.stringify(key)} at indices ${previous} and ${index}. Identity must be unique within the collection; use a composite domain identity when IDs are only locally unique.`,
      );
    seen.set(key, index);
    return key;
  });
}

/** Cached, validated rows for one identity. Sharing lives in `collection` so lists do not pull it in. */
function keyedRows<A>(identity: (item: A, index: number) => Identity) {
  const cache = new WeakMap<readonly A[], Rows<A>>();
  const validated = new WeakMap<readonly A[], readonly Identity[]>();
  const validate = (items: readonly A[]) => {
    let identities = validated.get(items);
    if (!identities) {
      identities = validateIdentities(items, identity);
      validated.set(items, identities);
    }
    return identities;
  };
  const from = (items: readonly A[]): Rows<A> => {
    const identities = validate(items);
    const cached = cache.get(items);
    if (cached) return cached;
    const rows: Rows<A> = {
      items,
      identity,
      length: items.length,
      validated: true,
      filter: (predicate) => from(items.filter(predicate)),
      slice: (start, end) => from(items.slice(start, end)),
    };
    rowIdentities.set(rows, identities);
    cache.set(items, rows);
    return rows;
  };
  return Object.assign(from, { validate });
}
function makeCollection<A>(identity: (item: A, index: number) => Identity) {
  const from = keyedRows(identity);
  const validate = from.validate;
  const comparisons = new WeakMap<readonly A[], WeakMap<readonly A[], readonly A[]>>();
  function share<B extends A>(this: void, previous: readonly B[], next: B[]): B[];
  function share<B extends A>(this: void, previous: readonly B[], next: readonly B[]): readonly B[];
  function share<B extends A>(
    this: void,
    previous: readonly B[],
    next: readonly B[],
  ): readonly B[] {
    const previousKeys = validate(previous);
    const nextKeys = validate(next);
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
      const key = nextKeys[index]!;
      let old = previous[index];
      if (index >= previous.length || !Object.is(previousKeys[index], key)) {
        if (!byIdentity) {
          byIdentity = new Map(previous.map((value, i) => [previousKeys[i]!, value]));
        }
        old = byIdentity.get(key);
      }
      const value = old === undefined ? item : shareData(old, item);
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

export interface Collection<A> {
  /** Identity reads `A`; rows keep the full type of the items supplied. */
  from<B extends A = A>(this: void, items: readonly B[]): Rows<B>;
  /** Reuse the previous row objects whose identity and data are unchanged. */
  share<B extends A>(this: void, previous: readonly B[], next: B[]): B[];
  share<B extends A>(this: void, previous: readonly B[], next: readonly B[]): readonly B[];
}

export function collection<A>(identity: (item: A, index: number) => Identity): Collection<A> {
  // Snapshot changes access permissions, not runtime representation. The implementation
  // only borrows supplied items, and never inserts values of a wider type.
  return makeCollection(identity) as unknown as Collection<A>;
}

/** Rows keyed by an inline identity, for `list(rows, identity, render)`. Nothing is cached. */
export function keyed<A>(
  items: readonly A[],
  identity: (item: A, index: number) => Identity,
): Rows<A> {
  return {
    items,
    identity,
    length: items.length,
    filter: (predicate) => keyed(items.filter(predicate), identity),
    slice: (start, end) => keyed(items.slice(start, end), identity),
  };
}

const positions = /* @__PURE__ */ keyedRows<unknown>((_item, index) => index);
/** Use positional identity for ordered values without stable entity IDs. */
export function sequence<A>(items: readonly A[]): Rows<A> {
  return positions(items) as Rows<A>;
}

const empty: readonly never[] = [];
const identified = /* @__PURE__ */ keyedRows<{ readonly id: Identity }>((item, index) => {
  if (item.id === undefined || item.id === null)
    throw new Error(
      `entities() row at index ${index} has no id. Give every row an id, or key the rows with list(rows, identity, render).`,
    );
  return item.id;
});
/** Rows keyed by their domain IDs. Reuses the wrapper for the same immutable array. */
export function entities<A extends { readonly id: Identity }>(
  items: readonly A[] | undefined,
): Rows<A> {
  // The collection retains, filters and slices supplied items; it never inserts wider values.
  return identified(items ?? empty) as unknown as Rows<A>;
}
