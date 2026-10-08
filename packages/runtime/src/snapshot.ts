import { isAsyncResult } from 'effect/reactivity/AsyncResult';

declare const __EFFECTWEB_DEV__: boolean | undefined;
/**
 * Published data is frozen in development builds (the Vite plugin defines `__EFFECTWEB_DEV__`),
 * so a mutation of a model, props or a query result throws where it happens instead of leaving
 * a view stale. Production builds skip the pass. Without the plugin, protection stays on.
 */
const protecting: boolean = typeof __EFFECTWEB_DEV__ === 'boolean' ? __EFFECTWEB_DEV__ : true;

/** Freeze published plain data in development. Opaque objects keep their own lifecycle. */
export function protectSnapshot<T>(value: T): T {
  if (protecting && value !== null && typeof value === 'object') protect(value);
  return value;
}

const protectedValues = new WeakSet<object>();
// Stored data is traversed without invoking application getters. A value is marked before its
// children are visited, which also ends cycles.
function protect(item: object): void {
  if (protectedValues.has(item)) return;
  protectedValues.add(item);
  // Effect wrappers remain opaque, but their successful UI data is plain data.
  if (isAsyncResult(item)) {
    const data: unknown =
      item._tag === 'Success'
        ? item.value
        : item._tag === 'Failure' && item.previousSuccess._tag === 'Some'
          ? item.previousSuccess.value
          : undefined;
    if (data !== null && typeof data === 'object') protect(data);
    return;
  }
  if (Array.isArray(item)) {
    // Elements are read by index: published arrays hold data, not accessors. Properties
    // beyond the indices and `length` are traversed like an object's.
    for (let index = 0; index < item.length; index++) {
      const child: unknown = item[index];
      if (child !== null && typeof child === 'object') protect(child);
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length !== item.length + 1)
      for (const key of keys) {
        if (key === 'length' || (typeof key === 'string' && /^\d+$/u.test(key))) continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (Object.hasOwn(descriptor, 'value')) {
          const child: unknown = descriptor.value;
          if (child !== null && typeof child === 'object') protect(child);
        }
      }
    Object.freeze(item);
    return;
  }
  const prototype: unknown = Object.getPrototypeOf(item);
  if (prototype !== Object.prototype && prototype !== null) return;
  for (const key of Reflect.ownKeys(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
    if (Object.hasOwn(descriptor, 'value')) {
      const child: unknown = descriptor.value;
      if (child !== null && typeof child === 'object') protect(child);
    }
  }
  Object.freeze(item);
}
