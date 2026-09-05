// Immutable snapshots can reach the renderer through several projections. Reuse an
// already compared object pair without retaining either snapshot after its owners release it.
const sharedPairs = new WeakMap<object, WeakMap<object, unknown>>();

/** Share JSON-shaped data; Blob, typed arrays and class instances retain their own identity. */
export function shareValue<T>(previous: T, next: T): T {
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
  if (pairs?.has(next)) return pairs.get(next) as T;
  const old = previous as Record<string, unknown>;
  const value = next as Record<string, unknown>;
  const keys = Object.keys(value);
  let equal = keys.length === Object.keys(old).length;
  let unchangedNext = true;
  const shared: Record<string, unknown> = array ? ([] as unknown as Record<string, unknown>) : {};
  for (const key of keys) {
    shared[key] = shareValue(old[key], value[key]);
    if (!Object.hasOwn(old, key) || shared[key] !== old[key]) equal = false;
    if (shared[key] !== value[key]) unchangedNext = false;
  }
  const result = equal ? previous : unchangedNext ? next : (shared as T);
  if (!pairs) {
    pairs = new WeakMap();
    sharedPairs.set(previous, pairs);
  }
  pairs.set(next, result);
  return result;
}
