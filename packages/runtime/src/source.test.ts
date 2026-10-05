import { describe, expect, it, vi } from 'vitest';
import { clock, mapSource, projectionSource } from './source.js';
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
