import { protectSnapshot, type Snapshot } from './snapshot.js';
import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';

import { loadEffect, type UiLoad } from './load.js';
import { shareData } from './sharing.js';
import { encodeQueryKey, type Query } from './query.js';
import { registerCache } from './cache-internals.js';
import { queryDefinition } from './query-internals.js';
import type { UiRuntime } from './runtime.js';
export { loadEffect, type UiLoad } from './load.js';
export { shareValue } from './share.js';

interface ResourceEntry {
  atom: Atom.Writable<AsyncResult.AsyncResult<unknown, unknown>, unknown>;
  load: () => UiLoad<unknown>;
  loadedAt?: number;
  query?: object;
}

export function makeQueryCache(): QueryCache<never>;
export function makeQueryCache<R>(runtime: UiRuntime<R>): QueryCache<R>;
export function makeQueryCache<R>(runtime?: UiRuntime<R>): QueryCache<R> {
  return createQueryCache(runtime);
}

function createQueryCache<R>(runtime?: UiRuntime<R>): QueryCache<R> {
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const generation = Atom.keepAlive(Atom.make(0));
  const resources = new Map<string, ResourceEntry>();
  // Follow registry-node lifetime; retaining definitions must not retain evicted data.
  const values = new WeakMap<AtomRegistry.Node<unknown>, { value: unknown }>();
  const identities = new WeakMap<object, number>();
  let disposed = false;
  let nextId = 0;
  const identity = (definition: object) => {
    let id = identities.get(definition);
    if (id === undefined) {
      id = ++nextId;
      identities.set(definition, id);
    }
    return id;
  };
  const acquire = <A, E>(
    key: string,
    load: () => Effect.Effect<A, E>,
    share: (previous: Snapshot<A>, next: A | Snapshot<A>) => A | Snapshot<A> = (previous, next) =>
      shareData(previous, next as Snapshot<A>),
  ) => {
    let entry = resources.get(key);
    if (entry) entry.load = load;
    else {
      const loaded = Atom.make((get) => {
        const previous = Option.flatMap(
          get.self<AsyncResult.AsyncResult<unknown, unknown>>(),
          AsyncResult.value,
        );
        return loadEffect(() => next.load()).pipe(
          Effect.map((value) => {
            const shared = Option.isSome(previous)
              ? share(previous.value as Snapshot<A>, value as A)
              : value;
            const snapshot = protectSnapshot(shared);
            remember(next, snapshot);
            return snapshot;
          }),
        );
      });
      const next: ResourceEntry = {
        load,
        atom: Atom.writable(loaded.read, (context, value: unknown) => {
          Atom.batch(() => {
            // Refresh disposes the load lifetime; setSelf publishes without starting another load.
            context.refreshSelf();
            remember(next, value);
            context.setSelf(AsyncResult.success(value));
          });
        }),
      };
      entry = next;
      resources.set(key, entry);
    }
    // Bound definitions as well as the registry's values. Mounted resources stay shared.
    if (resources.size > 512) {
      for (const [oldKey, old] of resources) {
        if (resources.size <= 512) break;
        if (oldKey !== key && !registry.getNodes().has(old.atom)) resources.delete(oldKey);
      }
    }
    return { entry, atom: entry.atom as Atom.Atom<AsyncResult.AsyncResult<Snapshot<A>, E>> };
  };
  const remember = (entry: ResourceEntry, value: unknown) => {
    entry.loadedAt = Date.now();
    const node = registry.getNodes().get(entry.atom);
    if (node) values.set(node, { value });
  };
  const previousValue = (entry: ResourceEntry | undefined) => {
    const node = entry && registry.getNodes().get(entry.atom);
    return node ? values.get(node) : undefined;
  };
  const checkWritable = () => {
    if (disposed) throw new Error('Cannot write to a disposed query cache.');
  };
  const queryKey = <Args, A, E>(definition: Query<Args, A, E, R>, args: Args | Snapshot<Args>) =>
    `query:${identity(definition)}:${encodeQueryKey(args as import('./query.js').QueryKey)}`;
  const acquireQuery = <Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: Args | Snapshot<Args>,
  ) => {
    const config = queryDefinition(definition);
    protectSnapshot(args);
    const { entry, atom } = acquire(
      queryKey(definition, args),
      () => {
        const effect = Effect.suspend(() => config.load(args as Snapshot<Args>));
        return runtime ? runtime.provide(effect) : (effect as Effect.Effect<A, E>);
      },
      config.share,
    );
    entry.query = definition;
    return { entry, atom, config };
  };
  const selectQuery = <Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: Args | Snapshot<Args>,
  ) => {
    const { entry, atom, config } = acquireQuery(definition, args);
    if (
      registry.getNodes().has(atom) &&
      entry.loadedAt !== undefined &&
      Date.now() - entry.loadedAt >= config.staleTime
    ) {
      const current = registry.get(atom);
      if (!current.waiting) registry.refresh(atom);
    }
    return atom;
  };
  const cache: QueryCache<R> = {
    prefetch<Args, A, E>(
      definition: Query<Args, A, E, R>,
      args: Args | Snapshot<Args>,
    ): Effect.Effect<Snapshot<A>, E> {
      return Effect.suspend(() =>
        AtomRegistry.getResult(registry, selectQuery(definition, args), { suspendOnWaiting: true }),
      );
    },
    setQueryData<Args, A, E>(
      definition: Query<Args, A, E, R>,
      args: Args | Snapshot<Args>,
      value: A | Snapshot<A>,
    ): Snapshot<A> {
      checkWritable();
      const { entry, config } = acquireQuery(definition, args);
      const previous = previousValue(entry);
      const next = protectSnapshot(value);
      const shared = previous
        ? config.share
          ? config.share(previous.value as Snapshot<A>, next)
          : shareData(previous.value as Snapshot<A>, next as Snapshot<A>)
        : next;
      const snapshot = protectSnapshot(shared) as Snapshot<A>;
      checkWritable();
      registry.set(entry.atom, snapshot);
      return snapshot;
    },
    updateQueryData<Args, A, E>(
      definition: Query<Args, A, E, R>,
      args: Args | Snapshot<Args>,
      update: (previous: Snapshot<A>) => A | Snapshot<A> | undefined,
    ): Snapshot<A> | undefined {
      checkWritable();
      queryDefinition(definition);
      protectSnapshot(args);
      const previous = previousValue(resources.get(queryKey(definition, args)));
      if (!previous) return undefined;
      const next = update(previous.value as Snapshot<A>);
      return next === undefined ? undefined : cache.setQueryData(definition, args, next);
    },
    invalidateQuery<Args, A, E>(
      definition: Query<Args, A, E, R>,
      ...selected: [] | [Args | Snapshot<Args>]
    ) {
      if (selected.length) {
        const entry = resources.get(queryKey(definition, selected[0]));
        if (entry) registry.refresh(entry.atom);
      } else {
        for (const entry of resources.values())
          if (entry.query === definition) registry.refresh(entry.atom);
      }
    },
    onReset(listener) {
      registry.get(generation);
      return registry.subscribe(generation, listener);
    },
    resetResources() {
      Atom.batch(() => {
        for (const entry of resources.values()) {
          entry.load = () => Effect.interrupt;
          registry.refresh(entry.atom);
        }
        resources.clear();
        registry.update(generation, (value) => value + 1);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      registry.dispose();
      resources.clear();
    },
  };
  registerCache(cache, { registry, generation, query: selectQuery });
  return Object.freeze(cache);
}

/** A cache owns one registry and the query resources published through it. */
export interface QueryCache<R = never> {
  prefetch<Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
  ): Effect.Effect<Snapshot<A>, E>;
  /** Publish a protected success, including undefined, and supersede any pending load for this key. */
  setQueryData<Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
    value: NoInfer<A> | Snapshot<NoInfer<A>>,
  ): Snapshot<A>;
  /**
   * Update an existing success, including one retained during refresh or failure, and supersede its load.
   * No success or an undefined updater return skips the write. Use setQueryData to seed or store undefined.
   * Updaters run synchronously on readonly data; a throw leaves the cached value unchanged.
   */
  updateQueryData<Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
    update: (previous: Snapshot<A>) => NoInfer<A> | Snapshot<NoInfer<A>> | undefined,
  ): Snapshot<A> | undefined;
  invalidateQuery<Args, A, E>(
    definition: Query<Args, A, E, R>,
    ...selected: [] | [NoInfer<Args> | Snapshot<NoInfer<Args>>]
  ): void;
  /** Observe account resets without exposing registry mutation. */
  onReset(listener: () => void): () => void;
  resetResources(): void;
  dispose(): void;
}
