import { describe, expect, it, vi } from 'vitest';
import { clock, mapSource, projectionSource, type Source } from './source.js';
import { program } from './program.js';

it('maps only explicitly selected data and does not own the producer', () => {
  const source = program({
    initial: { name: 'one', count: 0 },
    update: (model, patch: Partial<{ name: string; count: number }>) => ({
      model: { ...model, ...patch },
    }),
  });
  const selected = mapSource(source, (model) => model.name);
  const values: string[] = [];
  const stop = selected.subscribe((value) => values.push(value));
  source.send({ count: 1 });
  source.send({ name: 'two' });
  expect(selected.model()).toBe('two');
  stop();
  source.send({ name: 'three' });
  expect(selected.model()).toBe('three');
  expect(values).toEqual(['two']);
  source.dispose();
});

it('does not erase an observation that was read before its subscriber is notified', () => {
  const owner = program({ initial: 0, update: (_model, model: number) => ({ model }) });
  const selected = mapSource(owner, (value) => value + 1);
  const values: number[] = [];
  owner.subscribe(() => selected.model());
  const stop = selected.subscribe((value) => values.push(value));
  owner.send(1);
  expect(values).toEqual([2]);
  stop();
  owner.dispose();
});

it('shares a mapped producer subscription and releases it after the last observation', () => {
  const owner = program({ initial: 0, update: (_model, model: number) => ({ model }) });
  let active = 0;
  const source = {
    model: owner.model,
    subscribe(listener: (value: number) => void) {
      active++;
      const stop = owner.subscribe(listener);
      return () => {
        active--;
        stop();
      };
    },
  };
  const selected = mapSource(source, (value) => value * 2);
  const first: number[] = [],
    second: number[] = [];
  const stopFirst = selected.subscribe((value) => first.push(value));
  const stopSecond = selected.subscribe((value) => second.push(value));
  expect(active).toBe(1);
  owner.send(1);
  expect(first).toEqual([2]);
  expect(second).toEqual([2]);
  stopFirst();
  stopFirst();
  expect(active).toBe(1);
  owner.send(2);
  expect(second).toEqual([2, 4]);
  stopSecond();
  expect(active).toBe(0);
  owner.send(3);
  expect(selected.model()).toBe(6);
  const stopAgain = selected.subscribe((value) => second.push(value));
  owner.send(4);
  expect(second).toEqual([2, 4, 8]);
  stopAgain();
  expect(active).toBe(0);
  owner.dispose();
});

it('keeps duplicate callbacks as independent observations', () => {
  const owner = program({ initial: 0, update: (_model, model: number) => ({ model }) });
  const selected = mapSource(owner, (value) => value);
  const values: number[] = [];
  const listener = (value: number) => values.push(value);
  const first = selected.subscribe(listener),
    second = selected.subscribe(listener);
  owner.send(1);
  first();
  owner.send(2);
  expect(values).toEqual([1, 1, 2]);
  second();
  owner.dispose();
});

it('does not publish an older mapped value after a listener synchronously advances the producer', () => {
  let value = 0;
  const listeners = new Set<(value: number) => void>();
  const publish = (next: number) => {
    value = next;
    // oxlint-disable-next-line unicorn/no-useless-spread -- Match producer publication snapshot semantics.
    for (const listener of [...listeners]) listener(next);
  };
  const selected = mapSource(
    {
      model: () => value,
      subscribe(listener: (value: number) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    (value) => value,
  );
  const values: number[] = [];
  const first = selected.subscribe((next) => {
    if (next === 1) publish(2);
  });
  const second = selected.subscribe((next) => values.push(next));
  publish(1);
  expect(values).toEqual([2]);
  expect(selected.model()).toBe(2);
  first();
  second();
  expect(listeners.size).toBe(0);
});

it('batches projections and repeats invalidation during refresh without publishing stale data', async () => {
  let value = 0;
  const values: number[] = [];
  let invalidateDuringRefresh = false;
  const source = projectionSource({
    project: () => value,
    refresh() {
      if (invalidateDuringRefresh) {
        invalidateDuringRefresh = false;
        value++;
        source.changed();
      }
    },
  });
  source.start();
  source.subscribe((value) => values.push(value));
  value++;
  source.changed();
  source.changed();
  invalidateDuringRefresh = true;
  await Promise.resolve();
  await Promise.resolve();
  expect(values).toEqual([2]);
  source.dispose();
});

describe('clock', () => {
  it('ticks only while observed and publishes the current time', () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const minute = clock(60_000);
      expect(minute.model()).toBe(1_000);
      const seen: number[] = [];
      const stop = minute.subscribe((now) => seen.push(now));
      vi.advanceTimersByTime(120_000);
      expect(seen).toEqual([61_000, 121_000]);
      expect(minute.model()).toBe(121_000);
      stop();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(seen).toHaveLength(2);
      expect(minute.model()).toBe(181_000);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects a non-positive interval', () => {
    expect(() => clock(0)).toThrow(RangeError);
  });
});

it('clock keeps ticking for remaining observers when one unsubscribes during a tick', () => {
  vi.useFakeTimers({ now: 0 });
  try {
    const second = clock(1_000);
    const seen: string[] = [];
    let stopFirst = () => {};
    stopFirst = second.subscribe((now) => {
      seen.push(`first:${now}`);
      stopFirst();
    });
    const stopSecond = second.subscribe((now) => seen.push(`second:${now}`));
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual(['first:1000', 'second:1000']);
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual(['first:1000', 'second:1000', 'second:2000']);
    expect(vi.getTimerCount()).toBe(1);
    stopSecond();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('a projection follows watched inputs until they are released or it is disposed', async () => {
  const input = program({ initial: 1, update: (_model, model: number) => ({ model }) });
  const projection = projectionSource({ project: () => ({ doubled: input.model() * 2 }) });
  expect(() => projection.model()).toThrow(/Start projection/u);
  const release = projection.watch(input);
  projection.start();
  const values: number[] = [];
  projection.subscribe((model) => values.push(model.doubled));
  input.send(2);
  input.send(3);
  await Promise.resolve();
  // Notifications in one turn publish once, with the latest inputs.
  expect(values).toEqual([6]);
  release();
  release();
  input.send(4);
  await Promise.resolve();
  expect(values).toEqual([6]);
  const second = projection.watch(input);
  input.send(5);
  await Promise.resolve();
  expect(values).toEqual([6, 10]);
  projection.dispose();
  expect(projection.disposed).toBe(true);
  input.send(6);
  await Promise.resolve();
  expect(values).toEqual([6, 10]);
  // Watching after disposal subscribes to nothing.
  expect(projection.watch(input)).toBeTypeOf('function');
  second();
  input.dispose();
});

it('retries mapped observation after upstream acquisition fails', () => {
  const owner = program({ initial: 0, update: (_model, model: number) => ({ model }) });
  let fail = true;
  const selected = mapSource(
    {
      model: owner.model,
      subscribe(listener: (value: number) => void) {
        if (fail) throw new Error('acquisition failed');
        return owner.subscribe(listener);
      },
    },
    (value) => value * 2,
  );
  const failedValues: number[] = [];
  expect(() => selected.subscribe((value) => failedValues.push(value))).toThrow(
    'acquisition failed',
  );
  fail = false;
  const values: number[] = [];
  const stop = selected.subscribe((value) => values.push(value));
  owner.send(1);
  expect(failedValues).toEqual([]);
  expect(values).toEqual([2]);
  stop();
  owner.send(2);
  expect(values).toEqual([2]);
  owner.dispose();
});

it('reads deeply composed maps without recursively pulling cached parents', () => {
  let value = 1;
  const rootRead = vi.fn(() => value);
  const subscribe = vi.fn(() => () => {});
  let source: Source<number> = { model: rootRead, subscribe };
  const project = vi.fn((input: number) => input + 1);
  for (let index = 0; index < 10000; index++) source = mapSource(source, project);
  expect(source.model()).toBe(10001);
  expect(project).toHaveBeenCalledTimes(10000);
  expect(source.model()).toBe(10001);
  expect(project).toHaveBeenCalledTimes(10000);
  value = 2;
  expect(source.model()).toBe(10002);
  expect(project).toHaveBeenCalledTimes(20000);
  expect(rootRead).toHaveBeenCalledTimes(3);
  expect(subscribe).not.toHaveBeenCalled();
});

it('keeps intermediate map equality when fresh roots are read before notifications', () => {
  let current = { count: 1, other: 0 };
  const source: Source<typeof current> = { model: () => current, subscribe: () => () => {} };
  const parent = mapSource(
    source,
    (value) => ({ count: value.count }),
    (a, b) => a.count === b.count,
  );
  const childProject = vi.fn((value: { count: number }) => value.count * 2);
  const child = mapSource(parent, childProject);
  const initial = parent.model();
  expect(child.model()).toBe(2);
  current = { count: 1, other: 1 };
  expect(child.model()).toBe(2);
  expect(parent.model()).toBe(initial);
  expect(childProject).toHaveBeenCalledTimes(1);
  current = { count: 3, other: 1 };
  expect(child.model()).toBe(6);
  expect(childProject).toHaveBeenCalledTimes(2);
});

it('does not retain a stale flattened root across a reentrant producer change', () => {
  let current = 0;
  const listeners = new Set<(value: number) => void>();
  const owner = {
    model: () => current,
    subscribe(listener: (value: number) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(value: number) {
      current = value;
      // oxlint-disable-next-line unicorn/no-useless-spread -- Match producer publication snapshot semantics.
      for (const listener of [...listeners]) listener(value);
    },
  };
  const parent = mapSource(owner, (value) => value + 1);
  const child = mapSource(parent, (value) => value * 2);
  const first: number[] = [],
    second: number[] = [];
  const stopFirst = child.subscribe((value) => {
    first.push(value);
    if (value === 4) {
      owner.send(2);
      expect(child.model()).toBe(6);
    }
  });
  const stopSecond = child.subscribe((value) => second.push(value));
  owner.send(1);
  expect(child.model()).toBe(6);
  expect(first).toEqual([4, 6]);
  expect(second).toEqual([6]);
  stopFirst();
  stopSecond();
  expect(listeners.size).toBe(0);
});

it('flattens unchanged model functions forwarded through independently published wrappers', () => {
  let value = 1;
  const subscribe = vi.fn(() => () => {});
  let source: Source<number> = { model: () => value, subscribe };
  for (let index = 0; index < 10000; index++) {
    const wrapped = { model: source.model, subscribe };
    source = mapSource(wrapped, (input) => input + 1);
  }
  expect(source.model()).toBe(10001);
  value = 2;
  expect(source.model()).toBe(10002);
  expect(subscribe).not.toHaveBeenCalled();
});

it('keeps a transparent read wrapper publication boundary and subscription lifetime', () => {
  let value = 0;
  const subscribeRoot = vi.fn(() => () => {});
  const root: Source<number> = { model: () => value, subscribe: subscribeRoot };
  const parent = mapSource(root, (input) => input + 1);
  const listeners = new Set<(value: number) => void>();
  const wrapped: Source<number> = {
    model: parent.model,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const child = mapSource(wrapped, (input) => input * 2);
  const observed: number[] = [];
  const stop = child.subscribe((next) => observed.push(next));
  expect(listeners.size).toBe(1);
  expect(subscribeRoot).not.toHaveBeenCalled();
  value = 1;
  expect(child.model()).toBe(4);
  expect(observed).toEqual([]);
  for (const listener of listeners) listener(parent.model());
  expect(observed).toEqual([4]);
  stop();
  expect(listeners.size).toBe(0);
  value = 2;
  expect(child.model()).toBe(6);
  expect(observed).toEqual([4]);
  expect(subscribeRoot).not.toHaveBeenCalled();
});

it('refreshes a dormant child after its parent observes reused root identities', () => {
  const firstRoot = { value: 1 },
    otherRoot = { value: 2 };
  let root = firstRoot;
  const parent = mapSource({ model: () => root, subscribe: () => () => {} }, (value) => ({
    value: value.value,
  }));
  const child = mapSource(parent, (value) => value);
  const first = child.model();
  root = otherRoot;
  parent.model();
  root = firstRoot;
  const latest = parent.model();
  expect(latest).not.toBe(first);
  expect(child.model()).toBe(latest);
});

it('preserves comparator history across interleaved parent and wrapped descendant reads', () => {
  let root = 0;
  const parent = mapSource(
    { model: () => root, subscribe: () => () => {} },
    (value) => value,
    (a, b) => Math.abs(a - b) < 10,
  );
  const wrapped = { model: parent.model, subscribe: parent.subscribe };
  const child = mapSource(wrapped, (value) => value);
  const grandchild = mapSource(child, (value) => value * 2);
  expect(grandchild.model()).toBe(0);
  root = 20;
  expect(parent.model()).toBe(20);
  root = 9;
  expect(parent.model()).toBe(9);
  root = 0;
  expect(parent.model()).toBe(9);
  expect(child.model()).toBe(9);
  expect(grandchild.model()).toBe(18);
  expect(grandchild.model()).toBe(18);
});

it('keeps dormant mapped reads fresh when only the parent observes publications', () => {
  const owner = program({ initial: 0, update: (_previous, model: number) => ({ model }) });
  const parent = mapSource(
    owner,
    (value) => value,
    (a, b) => Math.abs(a - b) < 10,
  );
  const child = mapSource(parent, (value) => value);
  expect(child.model()).toBe(0);
  const parentValues: number[] = [];
  const stopParent = parent.subscribe((value) => parentValues.push(value));
  owner.send(20);
  owner.send(9);
  owner.send(0);
  expect(parentValues).toEqual([20, 9]);
  expect(child.model()).toBe(9);
  const childValues: number[] = [];
  const stopChild = child.subscribe((value) => childValues.push(value));
  owner.send(30);
  expect(childValues).toEqual([30]);
  stopChild();
  stopParent();
  owner.dispose();
});

it('owns duplicate projection subscriptions independently and releases all on disposal', async () => {
  let value = 0;
  const source = projectionSource({ project: () => value });
  source.start();
  const received: number[] = [];
  const listener = (next: number) => received.push(next);
  const stopFirst = source.subscribe(listener),
    stopSecond = source.subscribe(listener);
  value = 1;
  source.changed();
  await Promise.resolve();
  expect(received).toEqual([1, 1]);
  stopFirst();
  stopFirst();
  value = 2;
  source.changed();
  await Promise.resolve();
  expect(received).toEqual([1, 1, 2]);
  source.dispose();
  stopSecond();
  value = 3;
  source.changed();
  await Promise.resolve();
  expect(received).toEqual([1, 1, 2]);
});

it('retains intermediate comparator history when another branch reads the reused root', () => {
  let root = 0;
  const base = mapSource({ model: () => root, subscribe: () => () => {} }, (value) => value);
  const parent = mapSource(
    base,
    (value) => value,
    (a, b) => Math.abs(a - b) < 10,
  );
  const child = mapSource(parent, (value) => value);
  const sibling = mapSource(base, (value) => value * 2);
  expect(child.model()).toBe(0);
  root = 20;
  expect(parent.model()).toBe(20);
  root = 9;
  expect(parent.model()).toBe(9);
  root = 0;
  expect(sibling.model()).toBe(0);
  expect(child.model()).toBe(9);
  expect(parent.model()).toBe(9);
});

it('respects independent projection cleanup during a reentrant publication', async () => {
  let value = 0;
  const source = projectionSource({ project: () => value });
  source.start();
  const received: number[] = [];
  let stopSecond = () => {};
  const listener = (next: number) => {
    received.push(next);
    stopSecond();
  };
  const stopFirst = source.subscribe(listener);
  stopSecond = source.subscribe(listener);
  value = 1;
  source.changed();
  await Promise.resolve();
  expect(received).toEqual([1]);
  value = 2;
  source.changed();
  await Promise.resolve();
  expect(received).toEqual([1, 2]);
  stopFirst();
  source.dispose();
});

it('invalidates dormant descendants when a transparent wrapper publishes without reading its model', () => {
  let root = 0;
  const base = mapSource({ model: () => root, subscribe: () => () => {} }, (value) => value);
  const listeners = new Set<(value: number) => void>();
  const wrapped = {
    model: base.model,
    subscribe(listener: (value: number) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const parent = mapSource(
    wrapped,
    (value) => value,
    (a, b) => Math.abs(a - b) < 10,
  );
  const child = mapSource(parent, (value) => value);
  expect(child.model()).toBe(0);
  const values: number[] = [];
  const stop = parent.subscribe((value) => values.push(value));
  for (const next of [20, 9, 0]) {
    root = next;
    for (const listener of listeners) listener(next);
  }
  expect(values).toEqual([20, 9]);
  expect(parent.model()).toBe(9);
  expect(child.model()).toBe(9);
  stop();
  expect(listeners.size).toBe(0);
});
