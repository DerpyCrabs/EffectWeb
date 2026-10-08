import { shareData, type ShareFields as DataFields } from './sharing.js';

/** Field sharers borrow both inputs; returned branches are published as readonly data. */
export type ShareFields<T> = {
  readonly [K in keyof T]?: (previous: T[K], next: T[K]) => T[K];
};

/** Borrow shared immutable data. The result may retain either input and its nested branches. */
export function shareValue<T>(previous: T, next: T, fields?: ShareFields<T>): T {
  // Snapshot changes access permissions, not representation. The private algorithm only
  // borrows data; this boundary never exposes mutable aliases to its retained branches.
  return shareData(previous as T, next as T, fields as DataFields<T>) as T;
}
