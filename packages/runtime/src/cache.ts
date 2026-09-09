import { Settlement } from './settlement.js';
import { protectSnapshot, type Snapshot } from './snapshot.js';
import { Deferred, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';

import { loadEffect, type UiLoad } from './load.js';
import { shareData } from './sharing.js';
import { encodeQueryKey, type Query, type QueryGroup } from './query.js';
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
  args?: unknown;
  groups?: readonly symbol[] | undefined;
  unused?: 'retain' | 'cancel' | undefined;
  users: number;
  prefetches: Set<() => void>;
  revision: number;
  canceled?: boolean;
}

export interface QueryCacheOptions {
  readonly retention?: number;
  readonly unused?: 'retain' | 'cancel' | undefined;
}
export function makeQueryCache(options?: QueryCacheOptions): QueryCache<never>;
export function makeQueryCache<R>(
  runtime: UiRuntime<R>,
  options?: QueryCacheOptions,
): QueryCache<R>;
export function makeQueryCache<R>(
  runtimeOrOptions?: UiRuntime<R> | QueryCacheOptions,
  options: QueryCacheOptions = {},
): QueryCache<R> {
  return runtimeOrOptions && 'provide' in runtimeOrOptions
    ? createQueryCache(runtimeOrOptions, options)
    : createQueryCache(undefined, runtimeOrOptions);
}

function createQueryCache<R>(
  runtime?: UiRuntime<R>,
  options: QueryCacheOptions = {},
): QueryCache<R> {
  const retention = options.retention ?? 30_000;
  if (!Number.isFinite(retention) || retention < 0)
    throw new RangeError('Query retention must be finite and nonnegative.');
  const registry = AtomRegistry.make({ defaultIdleTTL: retention });
  const cancelValue = Symbol('cancel');
  const removeValue = Symbol('remove');
  const generation = Atom.keepAlive(Atom.make(0));
  const resources = new Map<string, ResourceEntry>();
  const entriesByAtom = new WeakMap<object, ResourceEntry>();
  // Follow registry-node lifetime; retaining definitions must not retain evicted data.
  const values = new WeakMap<AtomRegistry.Node<unknown>, { value: unknown }>();
  const identities = new WeakMap<object, number>();
  let disposed = false;
  const settlement = new Settlement();
  let closing: Promise<void> | undefined;
  let nextId = 0;
  let nextRevision = 0;
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
        next.revision = ++nextRevision;
        next.canceled = false;
        const revision = next.revision;
        return Effect.suspend(() => {
          const finish = settlement.begin();
          return loadEffect(() => next.load()).pipe(
            Effect.map((value) => {
              const shared = Option.isSome(previous)
                ? share(previous.value as Snapshot<A>, value as A)
                : value;
              const snapshot = protectSnapshot(shared);
              if (!disposed && revision === next.revision) remember(next, snapshot);
              return snapshot;
            }),
            Effect.ensuring(Effect.sync(finish)),
          );
        });
      });
      const next: ResourceEntry = {
        load,
        users: 0,
        prefetches: new Set(),
        revision: 0,
        atom: Atom.writable(loaded.read, (context, value: unknown) => {
          Atom.batch(() => {
            next.revision = ++nextRevision;
            // Refresh disposes the load lifetime; setSelf publishes without starting another load.
            context.refreshSelf();
            if (value === cancelValue || value === removeValue) {
              const previous = value === removeValue ? undefined : previousValue(next);
              next.canceled = true;
              if (value === removeValue) {
                delete next.loadedAt;
                const node = registry.getNodes().get(next.atom);
                if (node) values.delete(node);
              }
              context.setSelf(
                previous ? AsyncResult.success(previous.value) : AsyncResult.initial(),
              );
            } else {
              next.canceled = false;
              remember(next, value);
              context.setSelf(AsyncResult.success(value));
            }
          });
        }),
      };
      entry = next;
      resources.set(key, entry);
      entriesByAtom.set(entry.atom, entry);
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
        const effect = Effect.suspend(() =>
          config.load(
            args as Snapshot<Args>,
            previousValue(resources.get(queryKey(definition, args)))?.value as
              | Snapshot<A>
              | undefined,
          ),
        );
        return runtime ? runtime.provide(effect) : (effect as Effect.Effect<A, E>);
      },
      config.share,
    );
    entry.query = definition;
    entry.args = args;
    entry.groups = config.groups;
    entry.unused = config.unused ?? options.unused;
    return { entry, atom, config };
  };
  const refresh = (entry: ResourceEntry) => {
    entry.revision = ++nextRevision;
    registry.refresh(entry.atom);
  };
  const selectQuery = <Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: Args | Snapshot<Args>,
  ) => {
    const { entry, atom, config } = acquireQuery(definition, args);
    if (entry.canceled && !previousValue(entry)) refresh(entry);
    if (
      registry.getNodes().has(atom) &&
      entry.loadedAt !== undefined &&
      Date.now() - entry.loadedAt >= config.staleTime
    ) {
      const current = registry.get(atom);
      if (!current.waiting) refresh(entry);
    }
    return atom;
  };
  const retain = (atom: Atom.Atom<unknown>) => {
    const entry = entriesByAtom.get(atom);
    if (!entry) return () => {};
    entry.users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.users--;
      if (
        !disposed &&
        entry.users === 0 &&
        entry.unused === 'cancel' &&
        registry.getNodes().has(entry.atom) &&
        registry.get(entry.atom).waiting
      )
        registry.set(entry.atom, cancelValue);
    };
  };
  const abortPrefetches = (entry: ResourceEntry) => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Cancellation can add or remove observers reentrantly.
    for (const abort of [...entry.prefetches]) abort();
  };
  const cache: QueryCache<R> = {
    batch: Atom.batch,
    getQueryData<Args, A, E>(
      definition: Query<Args, A, E, R>,
      args: Args | Snapshot<Args>,
    ): Snapshot<A> | undefined {
      return previousValue(resources.get(queryKey(definition, args)))?.value as
        | Snapshot<A>
        | undefined;
    },
    invalidateWhere<Args, A, E>(
      definition: Query<Args, A, E, R>,
      predicate: (args: Snapshot<Args>) => boolean,
    ) {
      const selected = [...resources.values()].filter(
        (entry) => entry.query === definition && predicate(entry.args as Snapshot<Args>),
      );
      Atom.batch(() => {
        for (const entry of selected) refresh(entry);
      });
    },
    invalidateGroup(group) {
      Atom.batch(() => {
        for (const entry of resources.values()) if (entry.groups?.includes(group)) refresh(entry);
      });
    },
    cancelQuery(definition, ...selected) {
      Atom.batch(() => {
        for (const [key, entry] of resources)
          if (
            entry.query === definition &&
            (!selected.length || key === queryKey(definition, selected[0]))
          )
            if (registry.getNodes().has(entry.atom) && registry.get(entry.atom).waiting) {
              abortPrefetches(entry);
              registry.set(entry.atom, cancelValue);
            }
      });
    },
    removeQuery(definition, ...selected) {
      Atom.batch(() => {
        for (const [key, entry] of resources)
          if (
            entry.query === definition &&
            (!selected.length || key === queryKey(definition, selected[0]))
          )
            if (registry.getNodes().has(entry.atom)) {
              abortPrefetches(entry);
              registry.set(entry.atom, removeValue);
            }
      });
    },
    prefetch<Args, A, E>(
      definition: Query<Args, A, E, R>,
      args: Args | Snapshot<Args>,
      options?: { readonly refresh?: boolean },
    ): Effect.Effect<Snapshot<A>, E> {
      return Effect.suspend(() => {
        checkWritable();
        const atom = selectQuery(definition, args);
        const release = retain(atom);
        const entry = entriesByAtom.get(atom)!;
        const signal = Deferred.makeUnsafe<never>();
        const abort = () => {
          Deferred.doneUnsafe(signal, Effect.interrupt);
        };
        entry.prefetches.add(abort);
        return Effect.suspend(() => {
          if (options?.refresh && registry.getNodes().has(atom) && !registry.get(atom).waiting)
            refresh(entry);
          return Effect.raceFirst(
            Deferred.await(signal),
            AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }),
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              entry.prefetches.delete(abort);
              release();
            }),
          ),
        );
      });
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
        if (entry) refresh(entry);
      } else {
        cache.invalidateWhere(definition, () => true);
      }
    },
    onReset(listener) {
      registry.get(generation);
      return registry.subscribe(generation, listener);
    },
    resetResources() {
      Atom.batch(() => {
        for (const entry of resources.values()) {
          abortPrefetches(entry);
          entry.load = () => Effect.interrupt;
          refresh(entry);
        }
        resources.clear();
        registry.update(generation, (value) => value + 1);
      });
    },
    close() {
      if (!closing) {
        cache.dispose();
        closing = settlement.wait();
      }
      return closing;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of resources.values()) abortPrefetches(entry);
      registry.dispose();
      resources.clear();
    },
  };
  registerCache(cache, {
    disposed: () => disposed,
    refresh: (atom) => {
      const entry = entriesByAtom.get(atom);
      if (entry) refresh(entry);
    },
    registry,
    generation,
    query: selectQuery,
    retain,
    revision: (definition, args) => resources.get(queryKey(definition, args))?.revision,
  });
  return Object.freeze(cache);
}

/** A cache owns one registry and the query resources published through it. */
export interface QueryCache<R = never> {
  batch(work: () => void): void;
  getQueryData<Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
  ): Snapshot<A> | undefined;
  invalidateWhere<Args, A, E>(
    definition: Query<Args, A, E, R>,
    predicate: (args: Snapshot<Args>) => boolean,
  ): void;
  invalidateGroup(group: QueryGroup): void;
  /** Cancel requests while retaining the last success. Explicit refresh restarts them. */
  cancelQuery<Args, A, E>(
    definition: Query<Args, A, E, R>,
    ...selected: [] | [NoInfer<Args> | Snapshot<NoInfer<Args>>]
  ): void;
  /** Clear cached data and cancel requests; a subsequent selection or refresh reloads. */
  removeQuery<Args, A, E>(
    definition: Query<Args, A, E, R>,
    ...selected: [] | [NoInfer<Args> | Snapshot<NoInfer<Args>>]
  ): void;
  prefetch<Args, A, E>(
    definition: Query<Args, A, E, R>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
    options?: { readonly refresh?: boolean },
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
  /** Interrupt every request and wait for its finalizers, including previously canceled requests. */
  close(): Promise<void>;
  dispose(): void;
}
