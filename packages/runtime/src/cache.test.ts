import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeQueryCache, shareValue, type QueryCache } from './cache.js';

const models: QueryCache[] = [];
const model = () => {
  const current = makeQueryCache();
  models.push(current);
  return current;
};
afterEach(() => {
  for (const current of models.splice(0)) current.dispose();
});

describe('immutable sharing and UI resources', () => {
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

describe('UI resources', () => {
  it('uses the same result shape for synchronous and async Effects', async () => {
    const current = model();
    for (const [key, load] of [
      ['sync', () => Effect.succeed(42)],
      ['async', () => Effect.promise(() => Promise.resolve(42))],
    ] as const) {
      const atom = current.resource(key, load);
      expect(await Effect.runPromise(AtomRegistry.getResult(current.registry, atom))).toBe(42);
      expect(AsyncResult.isSuccess(current.registry.get(atom))).toBe(true);
    }
    const undefinedResult = current.registry.get(
      current.resource('undefined', () => Effect.succeed(undefined)),
    );
    expect(Option.isSome(AsyncResult.value(undefinedResult))).toBe(true);
  });

  it('deduplicates observers, reuses cached results and shares unchanged refresh values', async () => {
    const current = model();
    const load = vi.fn(() => Effect.succeed([{ id: 1, text: 'cached' }]));
    const first = current.resource('users:alice', load);
    const release = current.registry.mount(first);
    const value = Option.getOrThrow(AsyncResult.value(current.registry.get(first)));
    release();
    const again = current.resource('users:alice', load);
    expect(again).toBe(first);
    current.registry.mount(again);
    expect(load).toHaveBeenCalledTimes(1);
    current.invalidate('users:');
    expect(await Effect.runPromise(AtomRegistry.getResult(current.registry, again))).toBe(value);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps previous success while refreshing, without leaking a result to another key', async () => {
    const current = model();
    const alice = current.resource('alice', () => Effect.succeed('old'));
    current.registry.mount(alice);
    let finish!: (value: string) => void;
    current.resource('alice', () =>
      Effect.promise(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    current.invalidate('alice');
    const pending = current.registry.get(alice);
    expect(pending.waiting).toBe(true);
    expect(Option.getOrThrow(AsyncResult.value(pending))).toBe('old');
    const bob = current.resource('bob', () => Effect.never);
    current.registry.mount(bob);
    expect(Option.isNone(AsyncResult.value(current.registry.get(bob)))).toBe(true);
    finish('new');
    expect(
      await Effect.runPromise(
        AtomRegistry.getResult(current.registry, alice, { suspendOnWaiting: true }),
      ),
    ).toBe('new');
    expect(Option.isNone(AsyncResult.value(current.registry.get(bob)))).toBe(true);
  });

  it('interrupts account resources on reset and gives the next account fresh definitions', async () => {
    const current = model();
    const interrupted = vi.fn();
    const old = current.resource('profile', () =>
      Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
    );
    current.registry.mount(old);
    current.resetResources();
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    const fresh = current.resource('profile', () => Effect.succeed('new account'));
    expect(fresh).not.toBe(old);
    expect(await Effect.runPromise(AtomRegistry.getResult(current.registry, fresh))).toBe(
      'new account',
    );
  });

  it('interrupts in-flight Effects when the app is disposed', async () => {
    const current = model();
    const interrupted = vi.fn();
    current.registry.mount(
      current.resource('pending', () =>
        Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
      ),
    );
    current.dispose();
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
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

it('shares query results by domain identity for both observers and prefetch', async () => {
  const { collection } = await import('./collection.js');
  const { query } = await import('./query.js');
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
  const atom = cache.query(definition, true);
  const release = cache.registry.mount(atom);
  incoming = [...incoming].reverse();
  cache.invalidateQuery(definition);
  const refreshed = await Effect.runPromise(AtomRegistry.getResult(cache.registry, atom));
  expect(refreshed[0]).toBe(first[1]);
  expect(refreshed[1]).toBe(first[0]);
  expect(await Effect.runPromise(cache.prefetch(definition, true))).toBe(refreshed);
  release();
});
