import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { expect, it, vi } from 'vitest';
import { query } from './query.js';
import { modelOwner } from './owner.js';
import { resourceError } from './resource.js';
import { Cause } from 'effect';
import { makeQueryCache } from './cache.js';
import { queryResource, observeQuery } from './session.js';

it('selects typed query arguments, shares across sessions, and clears values across account changes', async () => {
  let account = 'first';
  const load = vi.fn((id: string) => Effect.succeed(`${account}:${id}`));
  const profile = query({ name: 'profile', key: (id: string) => id, load });
  const cache = makeQueryCache();
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
  const cache = makeQueryCache();
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
  const cache = makeQueryCache();
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
  const cache = owner.own(makeQueryCache());
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
  const seen = vi.fn();
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
  const cache = makeQueryCache();
  const definition = query({ name: 'selection', key: (id: string) => id, load: Effect.succeed });
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
    const cache = makeQueryCache();
    const original = cache.registry.subscribe.bind(cache.registry);
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    vi.spyOn(cache.registry, 'subscribe').mockImplementation((...args) => {
      const release = vi.fn(original(...args));
      releases.push(release);
      return release;
    });
    const definition = query({ name: 'selection', key: (id: string) => id, load: Effect.succeed });
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
  const cache = makeQueryCache();
  const definition = query({ name: 'listeners', load: () => Effect.succeed(1) });
  const source = queryResource({ cache }, definition);
  const seen = vi.fn();
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
