import type * as Effect from 'effect/Effect';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import { isAsyncResult } from 'effect/reactivity/AsyncResult';

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

const protectedValues = new WeakSet<object>();

/** Protect published plain data in every build. Opaque objects keep their own lifecycle. */
export function protectSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') protect(value);
  return value;
}
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
  const prototype: unknown = Object.getPrototypeOf(item);
  if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return;
  for (const key of Reflect.ownKeys(item)) {
    const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
    if (Object.hasOwn(descriptor, 'value')) {
      const child: unknown = descriptor.value;
      if (child !== null && typeof child === 'object') protect(child);
    }
  }
  Object.freeze(item);
}
