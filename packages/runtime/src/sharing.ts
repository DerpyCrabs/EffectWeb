// Snapshot inputs are immutable. Validate the entire incoming graph before invoking a
// field reconciler, and reuse the property names discovered by that traversal.
type Shape = { readonly keys: readonly string[]; readonly array: boolean; repeated: boolean };
const opaque = Symbol();
const circular = Symbol();
const graphs = new WeakMap<object, Shape | typeof opaque | typeof circular>();
const oldShapes = new WeakMap<object, Shape | typeof opaque>();
const comparisons = new WeakMap<object, WeakMap<object, unknown>>();
let comparingFields = false;

function dataProperty(descriptor: PropertyDescriptor): boolean {
  return descriptor.enumerable === true && Object.hasOwn(descriptor, 'value');
}

// A record supplied only on the previous side needs a shallow descriptor check.
function previousShape(value: object) {
  const checked = graphs.get(value);
  if (checked && checked !== circular) return checked;
  const cached = oldShapes.get(value);
  if (cached) return cached;
  const array = Array.isArray(value);
  if (
    (!array && Object.getPrototypeOf(value) !== Object.prototype) ||
    Object.getOwnPropertySymbols(value).length
  ) {
    oldShapes.set(value, opaque);
    return opaque;
  }
  const keys = Object.getOwnPropertyNames(value);
  if (array) keys.splice(keys.indexOf('length'), 1);
  const shape = keys.every((key) => dataProperty(Object.getOwnPropertyDescriptor(value, key)!))
    ? { keys, array, repeated: false }
    : opaque;
  oldShapes.set(value, shape);
  return shape;
}

function inspect(value: object, ancestors: Set<object>): Shape | typeof opaque | typeof circular {
  const cached = graphs.get(value);
  if (cached) {
    if (cached !== opaque && cached !== circular) cached.repeated = true;
    return cached;
  }
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype) {
    graphs.set(value, opaque);
    return opaque;
  }
  if (ancestors.has(value)) return circular;
  const names = Object.getOwnPropertyNames(value);
  if (array) names.splice(names.indexOf('length'), 1);
  const symbols = Object.getOwnPropertySymbols(value);
  const keys: (string | symbol)[] = symbols.length ? [...names, ...symbols] : names;
  let plain = !symbols.length;
  let entered = false;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!dataProperty(descriptor)) plain = false;
    const child: unknown = descriptor.value;
    if (child !== null && typeof child === 'object') {
      if (!entered) {
        ancestors.add(value);
        entered = true;
      }
      if (inspect(child, ancestors) === circular) {
        graphs.set(value, circular);
        return circular;
      }
    }
  }
  if (entered) ancestors.delete(value);
  const shape = plain ? { keys: names, array, repeated: false } : opaque;
  graphs.set(value, shape);
  return shape;
}

/** Override sharing for selected fields, for example a collection keyed by domain identity. */
export type ShareFields<T> = { readonly [K in keyof T]?: (previous: T[K], next: T[K]) => T[K] };
type RecordFields = ShareFields<Record<string, unknown>>;

/** Share immutable plain data; opaque objects, accessors, hidden fields and cycles retain next. */
export function shareData<T>(previous: T, next: T, fields?: ShareFields<T>): T {
  if (
    Object.is(previous, next) ||
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object'
  )
    return next;
  const shape = graphs.get(next) ?? inspect(next, new Set());
  if (shape === opaque || shape === circular) return next;
  if (!fields) return share(previous, next, shape, undefined, !comparingFields) as T;
  const outer = comparingFields;
  comparingFields = true;
  try {
    return share(previous, next, shape, fields as RecordFields, false) as T;
  } finally {
    comparingFields = outer;
  }
}

function share(
  previous: object,
  next: object,
  shape: Shape,
  fields: RecordFields | undefined,
  root: boolean,
): unknown {
  if (previous === next) return previous;
  let pairs = comparisons.get(previous);
  if (!fields && pairs?.has(next)) return pairs.get(next);
  if (Array.isArray(previous) !== shape.array) return next;
  const oldShape = previousShape(previous);
  if (oldShape === opaque) return next;
  const old = previous as Record<string, unknown>,
    value = next as Record<string, unknown>;
  const keys = shape.keys,
    oldKeys = oldShape.keys;
  let equal = keys.length === oldKeys.length && (!shape.array || value.length === old.length);
  let changed: Map<string, unknown> | undefined;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const present = oldKeys[i] === key || Object.hasOwn(old, key);
    const before = present ? old[key] : undefined,
      after = value[key];
    const custom = fields && present && Object.hasOwn(fields, key) ? fields[key] : undefined;
    let item = after;
    if (custom) item = custom(before, after);
    else if (present && Object.is(before, after)) continue;
    else if (after && typeof after === 'object' && before && typeof before === 'object') {
      // A proxy can return an object different from its own data descriptor.
      const child = graphs.get(after) ?? inspect(after, new Set());
      if (child !== opaque && child !== circular)
        item = share(before, after, child, undefined, false);
    }
    if (!present || !Object.is(item, before)) equal = false;
    if (!Object.is(item, after)) (changed ??= new Map()).set(key, item);
  }
  let result: object = equal ? previous : next;
  if (!equal && changed) {
    const copy: Record<string, unknown> = shape.array
      ? ([] as unknown as Record<string, unknown>)
      : {};
    if (shape.array) copy.length = value.length;
    for (const key of keys)
      Object.defineProperty(copy, key, {
        value: changed.has(key) ? changed.get(key) : value[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    result = copy;
  }
  // A partial copy must keep its identity across projections. Equal or unchanged
  // subtrees already have an identity; memoize these at the root and at shared nodes.
  if (!fields && (root || shape.repeated || (result !== previous && result !== next))) {
    if (!pairs) {
      pairs = new WeakMap();
      comparisons.set(previous, pairs);
    }
    pairs.set(next, result);
  }
  return result;
}
