import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { expect, it, vi } from 'vitest';
import { cacheInternals } from './cache-internals.js';
import { query } from './query.js';
import { available, resourceError } from 'effectweb';
import { Cause } from 'effect';
import { queryCache } from './cache.js';
import { modelOwner } from 'effectweb';
import { queryResource, observeQuery, querySource } from './observe.js';

it('selects typed query arguments, shares across sessions, and clears values across account changes', async () => {
  let account = 'first';
  const load = vi.fn((id: string) => Effect.succeed(`${account}:${id}`));
  const profile = query({ name: 'profile', load });
  const cache = queryCache();
  const context = { cache, changed: vi.fn() };
  const first = queryResource(context, profile);
  const second = queryResource(context, profile);
  const value = () => Option.getOrUndefined(AsyncResult.value(first.read()));
  first.select('alice');
  second.select('alice');
  expect(value()).toBe('first:alice');
  expect(load).toHaveBeenCalledTimes(1);
  first.select(undefined);
  expect(value()).toBeUndefined();
  expect(Option.getOrUndefined(AsyncResult.value(second.read()))).toBe('first:alice');
  first.select('alice');
  expect(load).toHaveBeenCalledTimes(1);
  first.select('bob');
  expect(value()).toBe('first:bob');
  account = 'second';
  cache.resetResources();
  expect(value()).toBeUndefined();
  first.select('bob');
  expect(value()).toBe('second:bob');
  second.select('alice');
  expect(Option.getOrUndefined(AsyncResult.value(second.read()))).toBe('second:alice');
  first.dispose();
  first.select('other');
  expect(value()).toBeUndefined();
  second.dispose();
  cache.dispose();
});

it('retains same-query values during failed refreshes and does not refresh on ordinary session ticks', async () => {
  let calls = 0;
  const data = query({
    name: 'data',
    staleTime: 0,
    load: () => (++calls === 2 ? Effect.fail('offline') : Effect.succeed('cached')),
  });
  const cache = queryCache();
  const source = queryResource({ cache, changed() {} }, data);
  source.select(true);
  source.select(true);
  expect(calls).toBe(1);
  source.refresh();
  expect(source.read()._tag).toBe('Failure');
  expect(Option.getOrUndefined(AsyncResult.value(source.read()))).toBe('cached');
  source.refresh();
  expect(source.read()._tag).toBe('Success');
  expect(calls).toBe(3);
  source.dispose();
  cache.dispose();
});

it('coalesces refreshes during a pending read, then permits revalidation after completion', async () => {
  let calls = 0;
  let finish!: () => void;
  const data = query({
    name: 'slow',
    load: () =>
      Effect.callback<number>((resume) => {
        const value = ++calls;
        finish = () => resume(Effect.succeed(value));
      }),
  });
  const cache = queryCache();
  const first = queryResource({ cache, changed() {} }, data);
  const second = queryResource({ cache, changed() {} }, data);
  try {
    first.select(true);
    second.select(true);
    for (let tick = 0; tick < 5; tick++) {
      first.refresh();
      second.refresh();
    }
    expect(calls).toBe(1);
    finish();
    await vi.waitFor(() => expect(first.read().waiting).toBe(false));
    expect(Option.getOrUndefined(AsyncResult.value(first.read()))).toBe(1);
    second.refresh();
    first.refresh();
    expect(calls).toBe(2);
    expect(Option.getOrUndefined(AsyncResult.value(first.read()))).toBe(1);
    finish();
    await vi.waitFor(() => expect(first.read().waiting).toBe(false));
    expect(Option.getOrUndefined(AsyncResult.value(first.read()))).toBe(2);
    cache.resetResources();
    first.refresh();
    expect(calls).toBe(2);
  } finally {
    first.dispose();
    second.dispose();
    cache.dispose();
  }
});

it('owns typed query publications, shares requests, retains undefined successes and releases observers', async () => {
  const owner = modelOwner<{ result: AsyncResult.AsyncResult<undefined, string> }>({
    result: AsyncResult.initial(),
  });
  const cache = owner.own(queryCache());
  let calls = 0;
  let finish!: () => void;
  const definition = query({
    name: 'undefined',
    load: () =>
      Effect.callback<undefined, string>((resume) => {
        calls++;
        finish = () => resume(Effect.succeed(undefined));
      }),
  });
  const seen = vi.fn<(result: AsyncResult.AsyncResult<undefined, string>) => void>();
  const first = observeQuery(owner, cache, definition, (result) => owner.patch({ result }));
  const second = observeQuery(owner, cache, definition, seen);
  first.select(true);
  second.select(true);
  expect(calls).toBe(1);
  finish();
  await vi.waitFor(() => expect(owner.read().result._tag).toBe('Success'));
  expect(Option.isSome(AsyncResult.value(owner.read().result))).toBe(true);
  expect(seen.mock.calls.at(-1)?.[0]._tag).toBe('Success');
  for (let index = 1; index < seen.mock.calls.length; index++)
    expect(seen.mock.calls[index]?.[0]).not.toBe(seen.mock.calls[index - 1]?.[0]);
  first.refresh();
  expect(Option.isSome(AsyncResult.value(owner.read().result))).toBe(true);
  cache.resetResources();
  expect(owner.read().result._tag).toBe('Initial');
  first.select(true);
  expect(calls).toBe(3);
  const publications = seen.mock.calls.length;
  owner.dispose();
  finish();
  first.select(true);
  expect(seen).toHaveBeenCalledTimes(publications);
});

it('formats query errors without exposing the Error constructor prefix', () => {
  expect(resourceError(AsyncResult.failure(Cause.fail(new Error('Try again.'))))).toBe(
    'Try again.',
  );
  expect(resourceError(AsyncResult.failure(Cause.fail('offline')))).toBe('offline');
  expect(resourceError(AsyncResult.failure(Cause.die(new Error('defect'))))).toBe('defect');
});

it('never delivers a superseded result after a listener selects another query', async () => {
  const cache = queryCache();
  const definition = query({ name: 'selection', load: (id: string) => Effect.succeed(id) });
  await Effect.runPromise(cache.prefetch(definition, 'A'));
  await Effect.runPromise(cache.prefetch(definition, 'B'));
  const source = queryResource({ cache }, definition);
  const seen: string[] = [];
  source.subscribe((result) => {
    if (AsyncResult.isSuccess(result) && result.value === 'A') source.select('B');
  });
  source.subscribe((result) => {
    if (AsyncResult.isSuccess(result)) seen.push(result.value);
  });
  source.select('A');
  expect(seen).toEqual(['B']);
  source.dispose();
  cache.dispose();
});

it.each(['select', 'reset', 'dispose'] as const)(
  'releases subscriptions after reentrant %s during setup',
  (action) => {
    const cache = queryCache();
    const internals = cacheInternals(cache);
    const original = internals.subscribe.bind(internals);
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(internals, 'subscribe').mockImplementation((...args) => {
      const release = vi.fn(original(...args));
      releases.push(release);
      return release;
    });
    const definition = query({ name: 'selection', load: (id: string) => Effect.succeed(id) });
    let triggered = false;
    const source = queryResource(
      {
        cache,
        changed() {
          if (triggered) return;
          triggered = true;
          if (action === 'select') source.select('B');
          else if (action === 'reset') cache.resetResources();
          else source.dispose();
        },
      },
      definition,
    );
    source.select('A');
    if (action === 'select')
      expect(Option.getOrUndefined(AsyncResult.value(source.read()))).toBe('B');
    else expect(source.read()._tag).toBe('Initial');
    source.dispose();
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
    cache.dispose();
  },
);

it('isolates throwing query listeners and stops publication when disposed', () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cache = queryCache();
  const definition = query({ name: 'listeners', load: () => Effect.succeed(1) });
  const source = queryResource({ cache }, definition);
  const seen = vi.fn<(result: AsyncResult.AsyncResult<number, never>) => void>();
  source.subscribe(() => {
    throw new Error('observer');
  });
  source.subscribe(seen);
  source.select(true);
  expect(seen).toHaveBeenCalled();
  expect(report).toHaveBeenCalled();
  source.dispose();
  const calls = seen.mock.calls.length;
  source.refresh();
  source.select(true);
  expect(seen).toHaveBeenCalledTimes(calls);
  cache.dispose();
  report.mockRestore();
});

it('lets an owner without a model own queries and cleanups in reverse order', () => {
  const cache = queryCache();
  const scope = modelOwner({});
  const changed = vi.fn();
  const order: string[] = [];
  scope.own(() => order.push('first'));
  const resource = observeQuery(
    scope,
    cache,
    query({ name: 'n', load: (n: number) => Effect.succeed(n * 2) }),
    changed,
  );
  scope.own(() => order.push('last'));
  resource.select(2);
  expect(Option.getOrUndefined(AsyncResult.value(resource.read()))).toBe(4);
  expect(changed).toHaveBeenCalled();
  scope.dispose();
  expect(order).toEqual(['last', 'first']);
  expect(scope.disposed).toBe(true);
  expect(resource.read()).toEqual(AsyncResult.initial());
  scope.own(() => order.push('late'));
  expect(order).toEqual(['last', 'first', 'late']);
  cache.dispose();
});

it('shares one query source per arguments, updates it live and releases it when unobserved', async () => {
  let version = 0;
  const load = vi.fn((id: string) => Effect.succeed(`${id}:${++version}`));
  const user = query({ name: 'source-user', load });
  const cache = queryCache();
  const first = querySource(cache, user, 'alice');
  expect(querySource(cache, user, 'alice')).toBe(first);
  expect(querySource(cache, user, 'bob')).not.toBe(first);
  const seen: unknown[] = [];
  const stop = first.subscribe((result) =>
    seen.push(Option.getOrUndefined(AsyncResult.value(result))),
  );
  expect(Option.getOrUndefined(AsyncResult.value(first.model()))).toBe('alice:1');
  cache.invalidateQuery(user, 'alice');
  await Effect.runPromise(Effect.yieldNow);
  expect(seen.at(-1)).toBe('alice:2');
  stop();
  await Promise.resolve();
  expect(querySource(cache, user, 'alice')).not.toBe(first);
  cache.dispose();
});

it('patches query results and projections into a model key', async () => {
  const owner = modelOwner<{
    result: AsyncResult.AsyncResult<number, never>;
    value: number | undefined;
  }>({ result: AsyncResult.initial(), value: undefined });
  const cache = owner.own(queryCache());
  const definition = query({ name: 'keyed', load: () => Effect.succeed(7) });
  const full = observeQuery(owner, cache, definition, 'result');
  const projected = observeQuery(owner, cache, definition, 'value', available);
  full.select(true);
  projected.select(true);
  await vi.waitFor(() => expect(owner.read().value).toBe(7));
  expect(owner.read().result._tag).toBe('Success');
  owner.dispose();
});
