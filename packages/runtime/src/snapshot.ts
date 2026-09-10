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
  const seen = new Set<object>();
  const plain: object[] = [];
  const validate = (item: unknown): void => {
    if (!item || typeof item !== 'object' || checked.has(item) || seen.has(item)) return;
    seen.add(item);
    // Effect wrappers remain opaque, but their successful UI data is plain data.
    if (isAsyncResult(item)) {
      if (item._tag === 'Success') validate(item.value);
      else if (item._tag === 'Failure' && item.previousSuccess._tag === 'Some')
        validate(item.previousSuccess.value);
      return;
    }
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return;
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!Object.hasOwn(descriptor, 'value'))
        throw new Error(
          `Snapshot data cannot contain an accessor (${String(key)}). Materialize its value before publication; keep services in opaque instances.`,
        );
      validate(descriptor.value as unknown);
    }
    plain.push(item);
  };
  // Validate the complete graph before caching any proof. A rejected cyclic graph
  // must not make a later publication skip validation through a previously seen child.
  validate(value);
  for (const item of plain) Object.freeze(item);
  for (const item of seen) checked.add(item);
  return value;
}
