import { expect, it } from 'vitest';
import { shareValue } from './share.js';

it('treats accessors as opaque without executing getters or replacing descriptors', () => {
  let reads = 0;
  const accessor = () =>
    Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        reads++;
        throw new Error('must not read');
      },
    });
  const old = accessor();
  const next = accessor();
  expect(shareValue(old, next)).toBe(next);
  expect(shareValue(old, { value: 1 })).toEqual({ value: 1 });
  expect(shareValue({ value: 1 }, next)).toBe(next);
  expect(shareValue({ child: old }, { child: next }).child).toBe(next);
  const array = Object.defineProperty([1], '0', {
    get() {
      reads++;
      return 1;
    },
  });
  expect(shareValue([1], array)).toBe(array);
  expect(reads).toBe(0);
});

it('preserves own __proto__ data while reusing unchanged nested values', () => {
  const previous = JSON.parse('{"data":{"x":1},"__proto__":{"admin":false}}') as {
    data: { x: number };
    __proto__: { admin: boolean };
  };
  const next = JSON.parse('{"data":{"x":1},"__proto__":{"admin":true}}') as typeof previous;
  const result = shareValue(previous, next);
  expect(result).toEqual(next);
  expect(result.data).toBe(previous.data);
  expect(Object.hasOwn(result, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect('admin' in result).toBe(false);
  expect(Object.hasOwn(Object.prototype, 'admin')).toBe(false);
});

it('does not discard symbol or nonenumerable data', () => {
  const tag = Symbol('tag');
  const previous = { text: 'same', [tag]: 'old' };
  const next = { text: 'same', [tag]: 'new' };
  expect(shareValue(previous, next)[tag]).toBe('new');
  const oldHidden = Object.defineProperty({ text: 'same' }, 'hidden', { value: 1 });
  const newHidden = Object.defineProperty({ text: 'same' }, 'hidden', { value: 2 });
  expect(Object.getOwnPropertyDescriptor(shareValue(oldHidden, newHidden), 'hidden')?.value).toBe(
    2,
  );
});

it('preserves sparse array length and the difference between a hole and undefined', () => {
  const holes: unknown[] = [];
  holes.length = 3;
  expect(shareValue([], holes)).toHaveLength(3);
  const previous = [{ id: 1 }];
  previous.length = 2;
  const next = [{ id: 1 }];
  next.length = 3;
  const result = shareValue(previous, next);
  expect(result).toHaveLength(3);
  expect(result[0]).toBe(previous[0]);
  expect(Object.hasOwn(result, 1)).toBe(false);
  expect(Object.hasOwn(result, 2)).toBe(false);
  const oneHole: unknown[] = [];
  oneHole.length = 1;
  expect(Object.hasOwn(shareValue(oneHole, [undefined]), 0)).toBe(true);
});

it('keeps cyclic graphs opaque without overflowing or constructing a broken cycle', () => {
  const previous: { child: { id: number }; self?: unknown } = { child: { id: 1 } };
  previous.self = previous;
  const next: typeof previous = { child: { id: 1 } };
  next.self = next;
  const result = shareValue(previous, next);
  expect(result).toBe(next);
  expect(result.self).toBe(result);
  expect(shareValue(previous, next)).toBe(next);
  const withNewBranch = { child: { id: 1 }, link: { parent: undefined as unknown } };
  withNewBranch.link.parent = withNewBranch;
  expect(
    shareValue<{ child: { id: number }; link?: { parent: unknown } }>(
      { child: { id: 1 } },
      withNewBranch,
    ),
  ).toBe(withNewBranch);
  // A repeated reference is not a cycle and should still share normally.
  const oldChild = { id: 1 };
  const newChild = { id: 1 };
  const oldDag = { a: oldChild, b: oldChild };
  expect(shareValue(oldDag, { a: newChild, b: newChild })).toBe(oldDag);
});

it('borrows frozen and unfrozen publications, including custom shared branches', () => {
  for (const frozen of [true, false]) {
    const item = { count: 1 };
    const previous = { items: [item], revision: 0 };
    if (frozen) {
      Object.freeze(item);
      Object.freeze(previous.items);
      Object.freeze(previous);
    }
    const next = { items: [{ count: 1 }], revision: 1 };
    const value = shareValue(previous, next, {
      items: (old, incoming) => shareValue(old, incoming),
    });
    expect(value).not.toBe(previous);
    expect(value.items).toBe(previous.items);
    expect(value.revision).toBe(1);
    expect(previous.revision).toBe(0);
    expect(next.items[0]).not.toBe(item);
  }
});
