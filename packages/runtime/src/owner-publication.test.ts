import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { modelOwner } from './owner.js';

it('publishes the accepted snapshot without copying it again', () => {
  const owner = modelOwner({ count: 0, payload: { label: 'shared' } });
  const payload = owner.read().payload;
  const seen: ReturnType<typeof owner.read>[] = [];
  owner.source.subscribe((model) => {
    expect(owner.read()).toBe(model);
    seen.push(model);
  });
  try {
    owner.patch({ count: 1 });
    expect(owner.source.model()).toBe(owner.read());
    expect(owner.read().payload).toBe(payload);
    owner.patch({ count: 1 });
    expect(seen).toHaveLength(1);
  } finally {
    owner.dispose();
  }
});

it('preserves accepted values while compact reentrant patches wait for publication', () => {
  const owner = modelOwner({ count: 0, label: '' });
  const accepted: ReturnType<typeof owner.read>[] = [];
  const published: ReturnType<typeof owner.read>[] = [];
  owner.source.subscribe((model) => {
    published.push(model);
    if (model.count !== 1) return;
    const patch = { count: 2 };
    owner.patch(patch);
    accepted.push(owner.read());
    patch.count = 999;
    owner.edit('count', (count) => count + 1);
    accepted.push(owner.read());
    owner.patch({ label: 'done' });
    accepted.push(owner.read());
    expect(owner.source.model()).toBe(model);
    expect(owner.read()).toEqual({ count: 3, label: 'done' });
  });
  try {
    owner.patch({ count: 1 });
    expect(published.map((model) => model.count)).toEqual([1, 2, 3, 3]);
    for (let index = 0; index < accepted.length; index++)
      expect(published[index + 1]).toEqual(accepted[index]);
    expect(owner.source.model()).toEqual(owner.read());
    owner.patch({ count: 3 });
    expect(published).toHaveLength(4);
    owner.patch({ label: 'next' });
    expect(owner.source.model()).toBe(owner.read());
  } finally {
    owner.dispose();
  }
});

it('keeps patches from command startup and cancellation finalizers in publication order', async () => {
  const owner = modelOwner({ count: 0 });
  const seen: number[] = [];
  owner.source.subscribe((model) => seen.push(model.count));
  try {
    owner.run(
      'work',
      Effect.sync(() => {
        owner.patch({ count: 1 });
        owner.edit('count', (count) => count + 1);
        expect(owner.read().count).toBe(2);
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(() => owner.edit('count', (count) => count + 1))),
      ),
      'replace',
    );
    owner.cancel('work');
    await Effect.runPromise(owner.awaitIdle());
    expect(seen).toEqual([1, 2, 3]);
    expect(owner.source.model()).toEqual(owner.read());
  } finally {
    await Effect.runPromise(owner.close());
  }
});

it('protects patched symbol data without freezing the caller patch container', () => {
  const symbol = Symbol('child');
  const owner = modelOwner({ tick: 0, stable: { value: 1 }, [symbol]: { nested: { value: 1 } } });
  const patch = { tick: 1, [symbol]: { nested: { value: 2 } } };
  owner.patch(patch);
  expect(Object.isFrozen(patch)).toBe(false);
  expect(Object.isFrozen(owner.read())).toBe(true);
  expect(Object.isFrozen(owner.read()[symbol].nested)).toBe(true);
  expect(() => owner.read()[symbol].nested.value++).toThrow(TypeError);
  owner.dispose();
});

it('fully protects values copied from accessor models and accessor patches', () => {
  const owner = modelOwner({
    tick: 0,
    get child() {
      return { nested: { value: 1 } };
    },
  });
  owner.patch({ tick: 1 });
  expect(Object.isFrozen(owner.read().child.nested)).toBe(true);
  let reads = 0;
  const patch = {
    get child() {
      reads++;
      return { nested: { value: reads } };
    },
  };
  owner.patch(patch);
  expect(Object.isFrozen(owner.read().child.nested)).toBe(true);
  expect(owner.read().child.nested.value).toBe(reads);
  owner.dispose();
});

it('does not protect ignored non-enumerable patch values', () => {
  const owner = modelOwner({ tick: 0 });
  const hidden = { value: 1 };
  const patch = { tick: 1 };
  Object.defineProperty(patch, '__proto__', { value: hidden });
  owner.patch(patch);
  expect(Object.hasOwn(owner.read(), '__proto__')).toBe(false);
  expect(Object.isFrozen(hidden)).toBe(false);
  owner.dispose();
});

it('protects the actual patch spread when a proxy exposes additional keys', () => {
  const owner = modelOwner<{ tick: number; child?: { nested: { value: number } } }>({ tick: 0 });
  const child = { nested: { value: 1 } };
  let enumerations = 0;
  const patch = new Proxy(
    { tick: 1, child },
    { ownKeys: () => (++enumerations === 1 ? ['tick'] : ['tick', 'child']) },
  );
  owner.patch(patch);
  expect(owner.read().child).toBe(child);
  expect(Object.isFrozen(child.nested)).toBe(true);
  owner.dispose();
});
