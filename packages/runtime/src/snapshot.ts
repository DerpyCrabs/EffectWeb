import type * as Effect from 'effect/Effect';
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

const protectedValues = new WeakSet<object>();

/** Protect published plain data in every build. Opaque objects keep their own lifecycle. */
export function protectSnapshot<T>(value: T): T {
  const seen = new Set<object>();
  const plain: object[] = [];
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object' || protectedValues.has(item) || seen.has(item)) return;
    seen.add(item);
    // Effect wrappers remain opaque, but their successful UI data is plain data.
    if (isAsyncResult(item)) {
      if (item._tag === 'Success') visit(item.value);
      else if (item._tag === 'Failure' && item.previousSuccess._tag === 'Some')
        visit(item.previousSuccess.value);
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return;
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (Object.hasOwn(descriptor, 'value')) visit(descriptor.value as unknown);
    }
    plain.push(item);
  };
  // Traverse stored data without invoking application getters.
  visit(value);
  for (const item of plain) Object.freeze(item);
  for (const item of seen) protectedValues.add(item);
  return value;
}
