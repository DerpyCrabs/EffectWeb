import { patchModel } from './state.js';
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
  if (protecting && value !== null && typeof value === 'object') protect(value, true);
  return value;
}

const protectedValues = new WeakSet<object>();
const dataRecords = new WeakSet<object>();

/** Internal owner fast path: inherited snapshot fields have already been protected. */
export function patchSnapshot<Model extends object>(model: Model, patch: Partial<Model>): Model {
  if (!protecting) return patchModel(model, patch);
  if (!dataRecords.has(model)) return protectSnapshot(patchModel(model, patch));
  return patchModel(model, patch, (previous, changes) => {
    // patchModel captures the actual spread values once, including accessor/proxy results.
    const next = { ...previous, ...changes };
    for (const key of Reflect.ownKeys(changes)) {
      const child: unknown = Reflect.get(changes, key);
      if (child !== null && typeof child === 'object') protect(child);
    }
    Object.freeze(next);
    protectedValues.add(next);
    dataRecords.add(next);
    return next;
  });
}
// Stored data is traversed without invoking application getters. A value is marked before its
// children are visited, which also ends cycles.
function protect(item: object, record = false): void {
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
    const keys = Object.getOwnPropertyNames(item);
    if (keys.length !== item.length + 1 || keys[keys.length - 1] !== 'length')
      for (const key of keys) {
        const index = Number(key);
        if (
          key === 'length' ||
          (String(index) === key && Number.isInteger(index) && index >= 0 && index < item.length)
        )
          continue;
        protectProperty(item, key);
      }
    for (const key of Object.getOwnPropertySymbols(item)) protectProperty(item, key);
    Object.freeze(item);
    return;
  }
  const prototype: unknown = Object.getPrototypeOf(item);
  if (prototype !== Object.prototype && prototype !== null) return;
  // Enumerating strings separately avoids Reflect.ownKeys' cost on ordinary data records.
  let dataOnly = true;
  for (const key of Object.getOwnPropertyNames(item))
    dataOnly = protectProperty(item, key) && dataOnly;
  for (const key of Object.getOwnPropertySymbols(item))
    dataOnly = protectProperty(item, key) && dataOnly;
  Object.freeze(item);
  if (record && dataOnly) dataRecords.add(item);
}

function protectProperty(item: object, key: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
  if (Object.hasOwn(descriptor, 'value')) {
    const child: unknown = descriptor.value;
    if (child !== null && typeof child === 'object') protect(child);
    return true;
  }
  return false;
}
