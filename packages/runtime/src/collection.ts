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
  return { from };
}

const positions = collection<unknown>((_item, index) => index);
/** Ordered protocol structures such as keyboard rows and rich-text fragments have positional identity. */
export function sequence<A>(items: readonly A[]): Rows<A> {
  return positions.from(items) as Rows<A>;
}
