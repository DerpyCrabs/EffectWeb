import { describe, expect, it } from 'vitest';
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

it('checks hidden back-references before invoking field sharers', () => {
  const previous = { items: [{ id: 1 }], meta: {} };
  const next = { items: [{ id: 1 }], meta: {} };
  Object.defineProperty(next.meta, Symbol('owner'), { value: next });
  let calls = 0;
  const fields = {
    items: (old: typeof previous.items) => {
      calls++;
      return old;
    },
  };
  expect(shareValue(previous, next, fields)).toBe(next);
  expect(calls).toBe(0);
  const acyclic = { items: [{ id: 1 }], meta: {}, revision: 1 };
  expect(shareValue(next, acyclic, fields).items).toBe(next.items);
  expect(calls).toBe(1);
});

it('compares a repeated incoming record against each previous counterpart independently', () => {
  const previous = { left: { id: 1 }, right: { id: 2 } };
  const shared = { id: 1 };
  const next = { left: shared, right: shared };
  for (const fields of [undefined, { left: shareValue, right: shareValue }]) {
    const result = shareValue(previous, next, fields);
    expect(result.left).toBe(previous.left);
    expect(result.right).toBe(shared);
    expect(result.right).not.toBe(previous.right);
  }
});

it('compares a shared leaf once across many paths through an immutable snapshot', () => {
  let reads = 0;
  function snapshot() {
    let node: object = new Proxy(
      { id: 1 },
      {
        get(target, key, receiver): unknown {
          if (key === 'id') reads++;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    for (let level = 0; level < 18; level++) node = { left: node, right: node };
    return node;
  }
  const previous = snapshot();
  expect(shareValue(previous, snapshot())).toBe(previous);
  expect(reads).toBeLessThan(10);
});

it('respects the field reconciler for equal lists and checks new rows for back-references', () => {
  type Row = { id: number; parent?: { items: Row[] } };
  const previous = { items: [{ id: 1 }] as Row[] };
  const next = structuredClone(previous);
  const chosen: Row[] = [];
  let calls = 0;
  const fields = {
    items: () => {
      calls++;
      return chosen;
    },
  };
  expect(shareValue(previous, next, fields).items).toBe(chosen);
  const circular = { items: [...next.items, { id: 2 }] as Row[] };
  circular.items[1]!.parent = circular;
  expect(shareValue(previous, circular, fields)).toBe(circular);
  expect(calls).toBe(1);
});

it('uses ordinary property reads for field reconciliation after checking the incoming graph', () => {
  const previous = { row: { id: 1 } };
  const row = new Proxy(
    { id: 1 },
    {
      get(target, key, receiver): unknown {
        return key === 'id' ? 2 : Reflect.get(target, key, receiver);
      },
    },
  );
  const fields = { row: shareValue };
  expect(shareValue(previous, { row }, fields).row).toBe(row);
  const fromProxy = new Proxy(
    { row: { id: 9 } },
    {
      get(target, key, receiver): unknown {
        return key === 'row' ? { id: 1 } : Reflect.get(target, key, receiver);
      },
    },
  );
  expect(shareValue(previous, fromProxy)).toBe(previous);
  const old = new Proxy(
    { id: 1, self: null as unknown },
    {
      get() {
        throw new Error('read previous before ruling out an incoming cycle');
      },
    },
  );
  const circular = { id: 1, self: null as unknown };
  circular.self = circular;
  expect(shareValue(old, circular, { id: (before) => before })).toBe(circular);
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

describe('immutable sharing', () => {
  it('reuses immutable comparison results across projections without cloning already shared input', () => {
    const previous = { child: { id: 1 }, version: 1 };
    const next = { child: { id: 1 }, version: 2 };
    const first = shareValue(previous, next);
    expect(first.child).toBe(previous.child);
    expect(shareValue(previous, next)).toBe(first);
    const alreadyShared = { child: previous.child, version: 3 };
    expect(shareValue(previous, alreadyShared)).toBe(alreadyShared);
  });

  it('handles removed optional fields and does not compare opaque media by contents', () => {
    const previous = {
      text: 'same',
      reply: 'removed',
      bytes: new Uint8Array([1]),
      blob: new Blob(['a']),
    };
    const next = { text: 'same', bytes: new Uint8Array([1]), blob: new Blob(['a']) };
    const shared = shareValue(previous, next);
    expect(shared).toEqual(next);
    expect(shared.bytes).toBe(next.bytes);
    expect(shared.blob).toBe(next.blob);
    expect('reply' in shared).toBe(false);
  });
});

it('applies explicit field sharing without polluting ordinary comparison caching', async () => {
  const { collection } = await import('./collection.js');
  const rows = collection<{ id: number; text: string }>((item) => item.id);
  const previous = {
    items: [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ],
    meta: { count: 2 },
    removed: true as boolean | undefined,
  };
  const next = { items: structuredClone([...previous.items].reverse()), meta: { count: 2 } };
  const positional = shareValue(previous, next);
  const keyed = shareValue(previous, next, { items: rows.share });
  expect(keyed).toEqual(next);
  expect(keyed.items[0]).toBe(previous.items[1]);
  expect(keyed.meta).toBe(previous.meta);
  expect('removed' in keyed).toBe(false);
  expect(shareValue(previous, next)).toBe(positional);
  expect(shareValue(previous, structuredClone(previous), { items: rows.share })).toBe(previous);
});
