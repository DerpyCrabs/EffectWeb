import { isAsyncResult } from 'effect/unstable/reactivity/AsyncResult';

/** Published fields cannot be reassigned. Nested domain types should also declare readonly data. */
export type Snapshot<T> = Readonly<T>;

declare const __EFFECTWEB_DEV__: boolean;
export const checkSnapshotsByDefault =
  typeof __EFFECTWEB_DEV__ !== 'undefined' && __EFFECTWEB_DEV__;
const checked = new WeakSet<object>();

/** Development guard for immutable plain data. Opaque objects keep their own lifecycle. */
export function protectSnapshot<T>(value: T, enabled: boolean): T {
  if (!enabled || !value || typeof value !== 'object' || checked.has(value)) return value;
  // AsyncResult is an immutable Effect wrapper, but its successful UI data is plain data.
  if (isAsyncResult(value)) {
    checked.add(value);
    if (value._tag === 'Success') protectSnapshot(value.value, true);
    else if (value._tag === 'Failure' && value.previousSuccess._tag === 'Some')
      protectSnapshot(value.previousSuccess.value, true);
    return value;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  // Mark before walking to allow cyclic data and reuse already checked shared branches.
  checked.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    // Never execute getters or traverse closures, class instances, Effects or DOM objects.
    if ('value' in descriptor) protectSnapshot(descriptor.value, true);
  }
  Object.freeze(value);
  return value;
}
