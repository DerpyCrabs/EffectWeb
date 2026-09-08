// Internal representation-level sharing. Public callers borrow through share.ts.
// Immutable snapshots can reach the renderer through several projections. Reuse an
// already compared object pair without retaining either snapshot after its owners release it.
const sharedPairs = new WeakMap<object, WeakMap<object, unknown>>();
const cyclicData = new WeakMap<object, boolean>();

function cyclic(value: object, active: Set<object>): boolean {
  const cached = cyclicData.get(value);
  if (cached !== undefined) return cached;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype) return false;
  if (active.has(value)) return true;
  active.add(value);
  const found = Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    const child: unknown = descriptor.value;
    return child !== null && typeof child === 'object' && cyclic(child, active);
  });
  active.delete(value);
  cyclicData.set(value, found);
  return found;
}

/** Override sharing for selected fields, for example a collection keyed by domain identity. */
export type ShareFields<T> = { readonly [K in keyof T]?: (previous: T[K], next: T[K]) => T[K] };

/** Share immutable plain data; opaque objects, accessors, hidden fields and cycles retain next. */
export function shareData<T>(previous: T, next: T, fields?: ShareFields<T>): T {
  if (Object.is(previous, next)) return previous;
  // Check the entire next graph, including new branches with no previous counterpart.
  // Otherwise a partial clone could keep a back-reference to the unshared root.
  if (next && typeof next === 'object' && cyclic(next, new Set())) return next;
  return share(previous, next, fields);
}

function share<T>(previous: T, next: T, fields: ShareFields<T> | undefined): T {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return next;
  const array = Array.isArray(next);
  if (array !== Array.isArray(previous)) return next;
  if (
    !array &&
    (Object.getPrototypeOf(next) !== Object.prototype ||
      Object.getPrototypeOf(previous) !== Object.prototype)
  )
    return next;
  let pairs = sharedPairs.get(previous);
  if (!fields && pairs?.has(next)) return pairs.get(next) as T;
  const old = previous as Record<string, unknown>;
  const value = next as Record<string, unknown>;
  const keys = Object.keys(value);
  const oldKeys = Object.keys(old);
  // Symbol and nonenumerable fields are outside the plain-data sharing contract.
  // Returning next preserves them instead of accidentally claiming value equality.
  const extra = array ? 1 : 0; // Array length is nonenumerable.
  if (
    Reflect.ownKeys(next).length !== keys.length + extra ||
    Reflect.ownKeys(previous).length !== oldKeys.length + extra ||
    keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(next, key)!, 'value')) ||
    oldKeys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(previous, key)!, 'value'))
  )
    return next;
  let equal = keys.length === oldKeys.length && (!array || value.length === old.length);
  let unchangedNext = true;
  const shared: Record<string, unknown> = array ? ([] as unknown as Record<string, unknown>) : {};
  if (array) shared.length = value.length;
  for (const key of keys) {
    const custom = fields && Object.hasOwn(fields, key) ? fields[key as keyof T] : undefined;
    const item =
      custom && Object.hasOwn(old, key)
        ? custom(old[key] as T[keyof T], value[key] as T[keyof T])
        : share(Object.hasOwn(old, key) ? old[key] : undefined, value[key], undefined);
    // Define an own data property, including __proto__, without invoking setters.
    Object.defineProperty(shared, key, {
      value: item,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    if (!Object.hasOwn(old, key) || !Object.is(item, old[key])) equal = false;
    if (!Object.is(item, value[key])) unchangedNext = false;
  }
  const result = equal ? previous : unchangedNext ? next : (shared as T);
  if (fields) return result;
  if (!pairs) {
    pairs = new WeakMap();
    sharedPairs.set(previous, pairs);
  }
  pairs.set(next, result);
  return result;
}
