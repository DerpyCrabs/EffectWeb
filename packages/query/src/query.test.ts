import { Context, Effect, Fiber, Option } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { makeQueryCache } from './cache.js';
import { cacheInternals } from './cache-internals.js';
import { query } from './query.js';
import { uiRuntime } from 'effectweb';

const disposals: Array<() => void> = [];
const cache = () => {
  const model = makeQueryCache();
  disposals.push(() => model.dispose());
  const internals = cacheInternals(model);
  // Mount an entry as an observer would: subscribed, so it loads and stays retained.
  const mount = (entry: Parameters<typeof internals.read>[0]) => {
    const stop = internals.subscribe(entry, () => {});
    internals.read(entry);
    return stop;
  };
  return { ...model, ...internals, mount };
};
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});
const value = <A, E>(state: AsyncResult.AsyncResult<A, E>) =>
  Option.getOrUndefined(AsyncResult.value(state));

describe('typed shared queries', () => {
  it('shares a request between consumers and prefetch, without using argument object identity', async () => {
    let finish!: () => void;
    const load = vi.fn((args: { id: string }) =>
      Effect.callback<{ id: string }>((resume) => {
        finish = () => resume(Effect.succeed({ id: args.id }));
      }),
    );
    const profile = query({ name: 'profile', load });
    const model = cache();
    const first = model.query(profile, { id: 'alice' });
    const second = model.query(profile, { id: 'alice' });
    expect(first).toBe(second);
    const release = model.mount(first);
    const prefetch = Effect.runPromise(model.prefetch(profile, { id: 'alice' }));
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    const result = await prefetch;
    expect(value(model.read(first))).toBe(result);
    release();
    expect(await Effect.runPromise(model.prefetch(profile, { id: 'alice' }))).toBe(result);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidates exact typed arguments or one definition without refetching other queries', async () => {
    const calls: string[] = [];
    const profile = query({
      name: 'profile',
      load: (id: string) =>
        Effect.sync(() => {
          calls.push(id);
          return { id, child: { unchanged: true } };
        }),
    });
    // Equal display names cannot alias a different definition's result type.
    const count = query({
      name: 'profile',
      load: () =>
        Effect.sync(() => {
          calls.push('count');
          return 1;
        }),
    });
    const model = cache();
    const alice = model.query(profile, 'alice');
    const bob = model.query(profile, 'bob');
    const unrelated = model.query(count, true);
    model.mount(alice);
    model.mount(bob);
    model.mount(unrelated);
    const before = value(model.read(alice));
    model.invalidateQuery(profile, 'alice');
    expect(value(model.read(alice))).toBe(before);
    expect(calls).toEqual(['alice', 'bob', 'count', 'alice']);
    model.invalidateQuery(profile);
    expect(calls).toEqual(['alice', 'bob', 'count', 'alice', 'alice', 'bob']);
  });

  it('revalidates stale cached values on selection, retaining success and deduplicating refreshes', async () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let calls = 0;
    let finish!: () => void;
    const data = query({
      name: 'data',
      staleTime: 50,
      load: () =>
        ++calls === 1
          ? Effect.succeed('old')
          : Effect.callback<string>((resume) => {
              finish = () => resume(Effect.succeed('new'));
            }),
    });
    const model = cache();
    const atom = model.query(data, true);
    const release = model.mount(atom);
    now = 149;
    model.query(data, true);
    expect(calls).toBe(1);
    now = 150;
    model.query(data, true);
    expect(model.read(atom).waiting).toBe(true);
    expect(value(model.read(atom))).toBe('old');
    model.query(data, true);
    expect(calls).toBe(2);
    finish();
    expect(await Effect.runPromise(model.prefetch(data, true))).toBe('new');
    release();
  });

  it('keeps the existing 30 second idle cache lifetime', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(() => Effect.succeed('cached'));
      const data = query({ name: 'data', load });
      const model = cache();
      const atom = model.query(data, true);
      const release = model.mount(atom);
      release();
      await vi.advanceTimersByTimeAsync(29_000);
      expect(model.getQueryData(data, true)).toBe('cached');
      await vi.advanceTimersByTimeAsync(1_500);
      expect(model.getQueryData(data, true)).toBeUndefined();
      await Effect.runPromise(model.prefetch(data, true));
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates account generations and interrupts pending old-account work', async () => {
    const model = cache();
    let account = 'old';
    let finish!: () => void;
    const interrupted = vi.fn<() => void>();
    const profile = query({
      name: 'me',
      load: () =>
        account === 'old'
          ? Effect.callback<string>((resume) => {
              finish = () => resume(Effect.succeed('old'));
            }).pipe(Effect.onInterrupt(() => Effect.sync(interrupted)))
          : Effect.succeed(account),
    });
    const old = model.query(profile, true);
    model.mount(old);
    account = 'new';
    model.resetResources();
    finish();
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    const fresh = model.query(profile, true);
    expect(fresh).not.toBe(old);
    expect(await Effect.runPromise(model.prefetch(profile, true))).toBe('new');
  });

  it('interrupts shared work only with its owning cache, not another consumer leaving', async () => {
    const interrupted = vi.fn<() => void>();
    const data = query({
      name: 'pending',
      load: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(interrupted))),
    });
    const model = cache();
    const atom = model.query(data, true);
    const first = model.mount(atom);
    const second = model.mount(atom);
    first();
    expect(interrupted).not.toHaveBeenCalled();
    const prefetch = Effect.runFork(model.prefetch(data, true));
    await Effect.runPromise(Fiber.interrupt(prefetch));
    expect(interrupted).not.toHaveBeenCalled();
    second();
    model.dispose();
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
  });

  it('executes service-using reads through the application runtime and preserves typed errors', async () => {
    interface Catalog {
      readonly prefix: string;
    }
    const Catalog = Context.Service<Catalog>('query-test/Catalog');
    type Missing = { readonly _tag: 'Missing'; readonly id: string };
    const data = query({
      name: 'catalog',
      load: (id: string) =>
        Effect.flatMap(Catalog, ({ prefix }) =>
          id ? Effect.succeed(`${prefix}:${id}`) : Effect.fail<Missing>({ _tag: 'Missing', id }),
        ),
    });
    const model = makeQueryCache(uiRuntime(Context.make(Catalog, { prefix: 'provided' })));
    disposals.push(() => model.dispose());
    expectTypeOf(model.prefetch(data, 'a')).toEqualTypeOf<Effect.Effect<string, Missing>>();
    expect(await Effect.runPromise(model.prefetch(data, 'a'))).toBe('provided:a');
    const failure = await Effect.runPromiseExit(model.prefetch(data, ''));
    expect(failure._tag).toBe('Failure');
    const typingOnly = () => {
      // @ts-expect-error A service-requiring query cannot run without its service context.
      const invalid = makeQueryCache().prefetch(data, 'a');
      void invalid;
      // @ts-expect-error Query arguments keep their declared type.
      model.invalidateQuery(data, 4);
    };
    void typingOnly;
  });
});
