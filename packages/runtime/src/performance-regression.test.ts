import { expect, it } from 'vitest';
import { mapSource, type Source } from './source.js';

for (const size of [100, 10_000]) {
  it(`selected subscriptions avoid whole-state work with ${size} retained records`, () => {
    const records = Array.from({ length: size }, (_, id) => ({ id, label: `record ${id}` }));
    let current = { records, progress: 0 };
    const listeners = new Set<(value: typeof current) => void>();
    const source: Source<typeof current> = {
      model: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    let projections = 0;
    const selected = mapSource(source, (state) => {
      projections++;
      return state.records;
    });
    let selectedWork = 0;
    let wholeStateWork = 0;
    const stops = Array.from({ length: 48 }, () =>
      selected.subscribe(() => {
        selectedWork++;
      }),
    );
    stops.push(
      source.subscribe(() => {
        wholeStateWork++;
      }),
    );
    expect(projections).toBe(1);
    for (let progress = 1; progress <= 100; progress++) {
      current = { records, progress };
      for (const listener of listeners) listener(current);
    }
    expect(projections).toBe(101);
    expect(selectedWork).toBe(0);
    expect(wholeStateWork).toBe(100);
    expect(selected.model()).toBe(records);
    for (const stop of stops) stop();
    expect(listeners.size).toBe(0);
    current = { records: [...records, { id: size, label: 'new' }], progress: 101 };
    const stop = selected.subscribe(() => {
      selectedWork++;
    });
    expect(selected.model()).toBe(current.records);
    stop();
    expect(listeners.size).toBe(0);
  });
}

it('owner patches do not revisit descriptors of a wide protected record', async () => {
  const { modelOwner } = await import('./owner.js');
  const owner = modelOwner({
    ...Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`field${i}`, i])),
    tick: 0,
  });
  const original = Object.getOwnPropertyDescriptor;
  let inspected = 0;
  Object.getOwnPropertyDescriptor = (target: object, key: PropertyKey) => {
    if (Object.hasOwn(target, 'field9999')) inspected++;
    return original(target, key);
  };
  try {
    for (let tick = 1; tick <= 10; tick++) owner.patch({ tick });
    expect(owner.read().tick).toBe(10);
    expect(Object.isFrozen(owner.read())).toBe(true);
    expect(inspected).toBe(0);
  } finally {
    Object.getOwnPropertyDescriptor = original;
    owner.dispose();
  }
});

it('snapshot bookkeeping remains one visit per nested data record', async () => {
  const { protectSnapshot } = await import('./snapshot.js');
  const value = { rows: Array.from({ length: 1000 }, (_, leaf) => ({ leaf })) };
  // oxlint-disable-next-line typescript/unbound-method -- Instrumentation forwards the original receiver with call.
  const original = WeakSet.prototype.add;
  let visits = 0;
  WeakSet.prototype.add = function (this: WeakSet<object>, item: object) {
    if (Object.hasOwn(item, 'leaf')) visits++;
    return original.call(this, item);
  };
  try {
    protectSnapshot(value);
  } finally {
    WeakSet.prototype.add = original;
  }
  expect(visits).toBe(1000);
  expect(Object.isFrozen(value.rows[999])).toBe(true);
});
