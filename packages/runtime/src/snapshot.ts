import type { Effect } from 'effect';
import type * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { isAsyncResult } from 'effect/unstable/reactivity/AsyncResult';

/** Mark an application service as opaque to snapshot typing; this is a type-only brand. */
export declare const snapshotOpaque: unique symbol;
export interface SnapshotOpaque {
  readonly [snapshotOpaque]?: true;
}

/** Recursively immutable published data. Effects, functions and external resources retain their API. */
export type Snapshot<T> = ImmutableValue<T>;
type SnapshotRecord<T> = { readonly [K in keyof T]: ImmutableValue<T[K]> };
type ImmutableValue<T> = T extends string | number | bigint | boolean | symbol | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : typeof snapshotOpaque extends keyof T
      ? symbol extends keyof T
        ? SnapshotRecord<T>
        : T
      : T extends AsyncResult.AsyncResult<infer A, infer E>
        ? AsyncResult.With<T, ImmutableValue<A>, E>
        : T extends
              | Effect.Effect<unknown, unknown, unknown>
              | Date
              | RegExp
              | Error
              | PromiseLike<unknown>
              | Node
              | EventTarget
              | Blob
              | ArrayBuffer
              | ArrayBufferView
          ? T
          : T extends ReadonlyMap<infer K, infer V>
            ? ReadonlyMap<ImmutableValue<K>, ImmutableValue<V>>
            : T extends ReadonlySet<infer A>
              ? ReadonlySet<ImmutableValue<A>>
              : T extends object
                ? SnapshotRecord<T>
                : T;

const checked = new WeakSet<object>();

/** Protect published plain data in every build. Opaque objects keep their own lifecycle. */
export function protectSnapshot<T>(value: T): T {
  if (!value || typeof value !== 'object' || checked.has(value)) return value;
  // AsyncResult is an immutable Effect wrapper, but its successful UI data is plain data.
  if (isAsyncResult(value)) {
    checked.add(value);
    if (value._tag === 'Success') protectSnapshot(value.value);
    else if (value._tag === 'Failure' && value.previousSuccess._tag === 'Some')
      protectSnapshot(value.previousSuccess.value);
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
    if ('value' in descriptor) protectSnapshot(descriptor.value);
  }
  Object.freeze(value);
  return value;
}
