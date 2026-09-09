import { Effect, Fiber } from 'effect';
import { expect, it, vi } from 'vitest';
import { makeQueryCache } from './cache.js';
import { query, queryGroup } from './query.js';
import { queryResource } from './session.js';

it('cancels only the last unused observer and restarts an abandoned selection', () => {
  let starts = 0,
    stops = 0;
  const definition = query({
    name: 'search',
    load: (term: string) =>
      Effect.sync(() => {
        starts++;
        return term;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(
          Effect.sync(() => {
            stops++;
          }),
        ),
      ),
  });
  const cache = makeQueryCache({ unused: 'cancel' });
  const a = queryResource({ cache }, definition),
    b = queryResource({ cache }, definition);
  a.select('a');
  b.select('a');
  expect(starts).toBe(1);
  a.dispose();
  expect(stops).toBe(0);
  b.select('b');
  expect(stops).toBe(1);
  b.select('a');
  expect(starts).toBe(3);
  b.dispose();
  expect(stops).toBe(3);
  cache.dispose();
});

it('prefetch retains a request after its observer leaves; cancellation retains a success', async () => {
  let stops = 0;
  const definition = query({
    name: 'warm',
    load: (key: string) =>
      Effect.never.pipe(
        Effect.as(key),
        Effect.ensuring(
          Effect.sync(() => {
            stops++;
          }),
        ),
      ),
  });
  const cache = makeQueryCache({ unused: 'cancel' });
  const warming = Effect.runFork(cache.prefetch(definition, 'a'));
  const observer = queryResource({ cache }, definition);
  observer.select('a');
  observer.dispose();
  expect(stops).toBe(0);
  await Effect.runPromise(Fiber.interrupt(warming));
  expect(stops).toBe(1);
  cache.setQueryData(definition, 'a', 'saved');
  cache.invalidateQuery(definition, 'a');
  const another = queryResource({ cache }, definition);
  another.select('a');
  another.dispose();
  expect(cache.getQueryData(definition, 'a')).toBe('saved');
  cache.removeQuery(definition, 'a');
  expect(cache.getQueryData(definition, 'a')).toBeUndefined();
  cache.dispose();
});

it('invalidates typed subsets and shared groups without conflating query identities', async () => {
  const group = queryGroup('files'),
    sameName = queryGroup('files');
  const loads: string[] = [];
  const a = query({
    name: 'a',
    groups: [group],
    load: (args: { path: string }) =>
      Effect.sync(() => {
        loads.push(`a:${args.path}`);
        return args.path;
      }),
  });
  const b = query({
    name: 'b',
    groups: [group],
    load: (args: string) =>
      Effect.sync(() => {
        loads.push(`b:${args}`);
        return args;
      }),
  });
  const cache = makeQueryCache();
  const observers = [queryResource({ cache }, a), queryResource({ cache }, a)];
  observers[0]!.select({ path: 'x' });
  observers[1]!.select({ path: 'y' });
  const other = queryResource({ cache }, b);
  other.select('x');
  loads.length = 0;
  cache.invalidateWhere(a, (args) => args.path === 'x');
  expect(loads).toEqual(['a:x']);
  loads.length = 0;
  cache.invalidateGroup(sameName);
  expect(loads).toEqual([]);
  cache.invalidateGroup(group);
  expect(loads.sort()).toEqual(['a:x', 'a:y', 'b:x']);
  for (const observer of observers) observer.dispose();
  other.dispose();
  cache.dispose();
});

it('close joins canceled request finalizers before an owned dependency closes', async () => {
  const cache = makeQueryCache({ unused: 'cancel' });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const definition = query({
    name: 'finalized',
    load: () =>
      Effect.never.pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            order.push('start');
            await gate;
            order.push('end');
          }),
        ),
      ),
  });
  const observer = queryResource({ cache }, definition);
  observer.select(true);
  observer.dispose();
  let closed = false;
  const close = cache.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(order).toEqual(['start']);
  release();
  await close;
  expect(order).toEqual(['start', 'end']);
});

it('a canceled uninterruptible load cannot overwrite a newer cached success', async () => {
  let release!: (value: string) => void;
  let finished = false;
  const definition = query({
    name: 'uninterruptible',
    load: () =>
      Effect.promise(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      ).pipe(
        Effect.uninterruptible,
        Effect.ensuring(
          Effect.sync(() => {
            finished = true;
          }),
        ),
      ),
  });
  const cache = makeQueryCache();
  const observer = queryResource({ cache }, definition);
  observer.select(true);
  cache.setQueryData(definition, true, 'new');
  release('old');
  await vi.waitFor(() => expect(finished).toBe(true));
  expect(cache.getQueryData(definition, true)).toBe('new');
  observer.dispose();
  await cache.close();
});

it('retains successes across observers until the configured retention expires', async () => {
  vi.useFakeTimers();
  const cache = makeQueryCache({ retention: 100, unused: 'cancel' });
  let starts = 0;
  const definition = query({ name: 'retention', load: () => Effect.sync(() => ++starts) });
  try {
    const first = queryResource({ cache }, definition);
    first.select(true);
    first.dispose();
    const second = queryResource({ cache }, definition);
    second.select(true);
    expect(starts).toBe(1);
    second.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cache.getQueryData(definition, true)).toBeUndefined();
    const third = queryResource({ cache }, definition);
    third.select(true);
    expect(starts).toBe(2);
    third.dispose();
  } finally {
    cache.dispose();
    vi.useRealTimers();
  }
});

it.each(['cancel', 'remove', 'reset', 'close'] as const)(
  'settles active prefetch Effects on %s instead of leaving initial-state waiters suspended',
  async (action) => {
    const cache = makeQueryCache();
    const definition = query({ name: 'cancel-prefetch', load: () => Effect.never });
    const result = Effect.runPromiseExit(cache.prefetch(definition, true));
    if (action === 'cancel') cache.cancelQuery(definition, true);
    else if (action === 'remove') cache.removeQuery(definition, true);
    else if (action === 'reset') cache.resetResources();
    else await cache.close();
    expect((await result)._tag).toBe('Failure');
    await cache.close();
  },
);

it('batches overlapping groups once and copies declared group membership', () => {
  const files = queryGroup('files'),
    recent = queryGroup('recent');
  const groups = [files, recent];
  let starts = 0;
  const definition = query({
    name: 'group-overlap',
    groups,
    load: () => Effect.sync(() => ++starts),
  });
  groups.length = 0;
  const cache = makeQueryCache();
  const observer = queryResource({ cache }, definition);
  observer.select(true);
  cache.batch(() => {
    cache.invalidateGroup(files);
    cache.invalidateGroup(recent);
  });
  expect(starts).toBe(2);
  observer.dispose();
  cache.dispose();
});
