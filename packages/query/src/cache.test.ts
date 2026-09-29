import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { query } from './query.js';
import { makeQueryCache, type QueryCache } from './cache.js';
import { queryResource } from './observe.js';

const models: QueryCache[] = [];
const model = () => {
  const current = makeQueryCache();
  models.push(current);
  return current;
};
afterEach(() => {
  for (const current of models.splice(0)) current.dispose();
});

describe('UI resources', () => {
  it('uses the same result shape for synchronous and async Effects', async () => {
    const current = model();
    for (const load of [
      () => Effect.succeed(42),
      () => Effect.promise(() => Promise.resolve(42)),
    ]) {
      const definition = query({ name: 'same display name', load });
      expect(await Effect.runPromise(current.prefetch(definition, true))).toBe(42);
    }
    const source = queryResource(
      { cache: current },
      query({ name: 'undefined', load: () => Effect.succeed(undefined) }),
    );
    source.select(true);
    expect(Option.isSome(AsyncResult.value(source.read()))).toBe(true);
    source.dispose();
  });

  it('deduplicates observers, reuses cached results and shares unchanged refresh values', async () => {
    const current = model();
    const load = vi.fn(() => Effect.succeed([{ id: 1, text: 'cached' }]));
    const definition = query({ name: 'users', load });
    const first = queryResource({ cache: current }, definition);
    first.select(true);
    const value = Option.getOrThrow(AsyncResult.value(first.read()));
    first.dispose();
    const again = queryResource({ cache: current }, definition);
    again.select(true);
    expect(Option.getOrThrow(AsyncResult.value(again.read()))).toBe(value);
    expect(load).toHaveBeenCalledTimes(1);
    current.invalidateQuery(definition);
    expect(await Effect.runPromise(current.prefetch(definition, true))).toBe(value);
    expect(load).toHaveBeenCalledTimes(2);
    again.dispose();
  });

  it('keeps previous success while refreshing, without leaking a result to another key', async () => {
    const current = model();
    let finish!: (value: string) => void;
    let refresh = false;
    const definition = query({
      name: 'people',
      load: (id: string) =>
        id === 'bob'
          ? Effect.never
          : refresh
            ? Effect.promise(
                () =>
                  new Promise<string>((resolve) => {
                    finish = resolve;
                  }),
              )
            : Effect.succeed('old'),
    });
    const alice = queryResource({ cache: current }, definition);
    const bob = queryResource({ cache: current }, definition);
    alice.select('alice');
    refresh = true;
    current.invalidateQuery(definition, 'alice');
    expect(alice.read().waiting).toBe(true);
    expect(Option.getOrThrow(AsyncResult.value(alice.read()))).toBe('old');
    bob.select('bob');
    expect(Option.isNone(AsyncResult.value(bob.read()))).toBe(true);
    finish('new');
    expect(await Effect.runPromise(current.prefetch(definition, 'alice'))).toBe('new');
    expect(Option.isNone(AsyncResult.value(bob.read()))).toBe(true);
    alice.dispose();
    bob.dispose();
  });

  it('interrupts account resources on reset and gives the next account fresh definitions', async () => {
    const current = model();
    const interrupted = vi.fn<() => void>();
    let account = 'old';
    const definition = query({
      name: 'profile',
      load: () =>
        account === 'old'
          ? Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted)))
          : Effect.succeed(account),
    });
    const source = queryResource({ cache: current }, definition);
    source.select(true);
    current.resetResources();
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    account = 'new account';
    source.select(true);
    expect(await Effect.runPromise(current.prefetch(definition, true))).toBe('new account');
    source.dispose();
  });

  it('interrupts in-flight Effects when the app is disposed', async () => {
    const current = model();
    const interrupted = vi.fn<() => void>();
    const source = queryResource(
      { cache: current },
      query({
        name: 'pending',
        load: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
      }),
    );
    source.select(true);
    current.dispose();
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    source.dispose();
  });
});

it('shares query results by domain identity for both observers and prefetch', async () => {
  const { collection } = await import('effectweb');
  const rows = collection<{ id: number; text: string }>((item) => item.id);
  let incoming = [
    { id: 1, text: 'a' },
    { id: 2, text: 'b' },
  ];
  const definition = query({
    name: 'entities',
    load: () => Effect.sync(() => structuredClone(incoming)),
    share: rows.share,
  });
  const cache = model();
  const first = await Effect.runPromise(cache.prefetch(definition, true));
  const resource = queryResource({ cache }, definition);
  resource.select(true);
  incoming = [...incoming].reverse();
  cache.invalidateQuery(definition);
  const refreshed = await Effect.runPromise(cache.prefetch(definition, true));
  expect(refreshed[0]).toBe(first[1]);
  expect(refreshed[1]).toBe(first[0]);
  expect(await Effect.runPromise(cache.prefetch(definition, true))).toBe(refreshed);
  resource.dispose();
});

it('exposes reset observation without registry mutation and releases listeners', () => {
  const cache = model();
  let resets = 0;
  const stop = cache.onReset(() => {
    resets++;
  });
  expect(resets).toBe(0);
  cache.resetResources();
  expect(resets).toBe(1);
  stop();
  cache.resetResources();
  expect(resets).toBe(1);
});
