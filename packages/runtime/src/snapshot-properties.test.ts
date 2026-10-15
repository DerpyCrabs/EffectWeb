import { expect, it } from 'vitest';
import { protectSnapshot } from './snapshot.js';

it('protects sparse array data, including hidden, symbol and non-index numeric properties', () => {
  const symbol = Symbol('data');
  const array: unknown[] = [];
  array[3] = undefined;
  const children = [{ value: 1 }, { value: 2 }, { value: 3 }];
  Object.defineProperty(array, 'hidden', { value: children[0] });
  Object.defineProperty(array, '01', { value: children[1] });
  Object.defineProperty(array, symbol, { value: children[2] });
  // Extra properties happen to make this look like a dense array by key count.
  expect(Reflect.ownKeys(array)).toHaveLength(array.length + 1);
  protectSnapshot(array);
  expect(Object.isFrozen(array)).toBe(true);
  for (const child of children) {
    expect(Object.isFrozen(child)).toBe(true);
    expect(() => child.value++).toThrow(TypeError);
  }
});

it('protects non-enumerable and symbol data in null-prototype cyclic records', () => {
  const symbol = Symbol('data');
  const child = { value: 1 };
  const root = Object.create(null) as Record<PropertyKey, unknown>;
  root.self = root;
  Object.defineProperty(root, 'hidden', { value: child });
  root[symbol] = [child, root];
  Object.freeze(root);
  expect(protectSnapshot(root)).toBe(root);
  expect(Object.isFrozen(child)).toBe(true);
  expect(Object.isFrozen(root[symbol])).toBe(true);
});
