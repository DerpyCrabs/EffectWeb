import type { RunKey } from './program.js';
// Tagged, length-delimited JSON values avoid scalar/tuple and number/string collisions.
const scalar = (value: string | number): readonly [string, string] =>
  typeof value === 'string' ? ['string', value] : ['number', String(value)];
export const encodeKey = (key: RunKey): string =>
  JSON.stringify(Array.isArray(key) ? ['array', key.map(scalar)] : scalar(key as string | number));
export const equalKeys = (a: RunKey, b: RunKey): boolean => encodeKey(a) === encodeKey(b);
export const copyKey = (key: RunKey): RunKey =>
  Array.isArray(key) ? Object.freeze([...(key as readonly (string | number)[])]) : key;
export class KeyMap<V> {
  private readonly entries = new Map<string, { key: RunKey; value: V }>();
  get size() {
    return this.entries.size;
  }
  get(key: RunKey): V | undefined {
    return this.entries.get(encodeKey(key))?.value;
  }
  has(key: RunKey): boolean {
    return this.entries.has(encodeKey(key));
  }
  set(key: RunKey, value: V): void {
    this.entries.set(encodeKey(key), { key: copyKey(key), value });
  }
  delete(key: RunKey): boolean {
    return this.entries.delete(encodeKey(key));
  }
  *keys(): IterableIterator<RunKey> {
    for (const entry of this.entries.values()) yield entry.key;
  }
}
