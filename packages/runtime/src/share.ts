import type { Snapshot } from './snapshot.js';
import { shareData, type ShareFields as DataFields } from './sharing.js';

/** Field sharers borrow both inputs; returned branches are published as readonly data. */
export type ShareFields<T> = {
  readonly [K in keyof T]?: (
    previous: Snapshot<T[K]>,
    next: Snapshot<T[K]>,
  ) => T[K] | Snapshot<T[K]>;
};

/** Borrow shared immutable data. The result may retain either input and its nested branches. */
export function shareValue<T>(
  previous: T | Snapshot<T>,
  next: T | Snapshot<T>,
  fields?: ShareFields<T>,
): Snapshot<T> {
  // Snapshot changes access permissions, not representation. The private algorithm only
  // borrows data; this boundary never exposes mutable aliases to its retained branches.
  return shareData(previous as T, next as T, fields as DataFields<T>) as Snapshot<T>;
}
