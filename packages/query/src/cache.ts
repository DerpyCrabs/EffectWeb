import { Settlement } from './settlement.js';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import * as Context from 'effect/Context';
import { encodeQueryArguments, type Query, type QueryGroup } from './query.js';
import { registerCache, type QueryEntry } from './cache-internals.js';
import { queryDefinition } from './query-internals.js';
import { reportError, reportSafely } from './errors.js';
import { protectSnapshot, shareValue } from 'effectweb/advanced';
import type { Snapshot } from 'effectweb';
import * as Clock from 'effect/Clock';

type Result = AsyncResult.AsyncResult<unknown, unknown>;
/** The current load of an entry: its fiber, resource scope and completion accounting. */
interface Lifetime {
  dispose(): void;
}
interface ResourceEntry {
  key: string;
  load: () => Effect.Effect<unknown, unknown, Scope.Scope>;
  share: (previous: Snapshot<unknown>, next: unknown) => unknown;
  loadedAt?: number;
  query?: object;
  args?: unknown;
  groups?: readonly symbol[] | undefined;
  unused?: 'retain' | 'cancel' | undefined;
  users: number;
  prefetches: Set<() => void>;
  revision: number;
  canceled?: boolean;
  /** Cached data survives failures and cancellation; eviction and removal forget it. */
  value?: { value: unknown } | undefined;
  /** Whether the entry is mounted; unmounted entries load again when next read. */
  alive: boolean;
  /** A mounted entry that must load on its next read. */
  stale: boolean;
  state: Result;
  listeners: Set<() => void>;
  lifetime?: Lifetime | undefined;
  eviction?: ReturnType<typeof setTimeout> | undefined;
}

type TypedResourceEntry<A, E> = ResourceEntry & QueryEntry<A, E>;

export interface QueryCacheOptions {
  /** Milliseconds an unobserved entry keeps its data before it is evicted. Defaults to 30 000. */
  readonly retention?: number;
  /**
   * What happens to a request in flight when its last observer leaves: `retain` lets it
   * finish into the cache (the default), `cancel` interrupts it. A query's own `unused` wins.
   */
  readonly unused?: 'retain' | 'cancel' | undefined;
}
/**
 * A shared query cache. `context` supplies the services loaders require and the clock used for
 * staleness: `queryCache(Context.make(Api, api))`, or `queryCache(yield* Effect.context<Api>())`
 * inside an Effect. Scope it with `Effect.acquireRelease(…, (cache) => cache.close())`.
 */
export function queryCache(options?: QueryCacheOptions): QueryCache<never>;
export function queryCache<R>(
  context: Context.Context<R>,
  options?: QueryCacheOptions,
): QueryCache<R>;
export function queryCache<R>(
  contextOrOptions?: Context.Context<R> | QueryCacheOptions,
  options: QueryCacheOptions = {},
): QueryCache<R> | QueryCache<never> {
  return Context.isContext(contextOrOptions)
    ? createQueryCache(contextOrOptions as Context.Context<R>, options)
    : createQueryCache(Context.empty() as Context.Context<R>, contextOrOptions);
}

const settled = <A, E>(
  result: AsyncResult.AsyncResult<A, E>,
): result is AsyncResult.Success<A, E> | AsyncResult.Failure<A, E> =>
  result._tag !== 'Initial' && !result.waiting;

const settledExit = <A, E>(
  result: AsyncResult.Success<A, E> | AsyncResult.Failure<A, E>,
): Exit.Exit<A, E> =>
  result._tag === 'Success' ? Exit.succeed(result.value) : Exit.failCause(result.cause);

// Resource storage erases types; a handle acquired with a query definition restores them.
const resultOf = <A, E>(entry: TypedResourceEntry<A, E>) =>
  entry.state as AsyncResult.AsyncResult<Snapshot<A>, E>;

function createQueryCache<R>(
  context: Context.Context<R>,
  options: QueryCacheOptions = {},
): QueryCache<R> {
  const retention = options.retention ?? 30_000;
  if (!Number.isFinite(retention) || retention < 0)
    throw new RangeError('Query retention must be finite and nonnegative.');
  const clock = Context.get(context, Clock.Clock);
  const resources = new Map<string, ResourceEntry>();
  const identities = new WeakMap<object, number>();
  let disposed = false;
  const settlement = new Settlement();
  let closing: Effect.Effect<void> | undefined;
  let nextId = 0;
  let nextRevision = 0;
  let generation = 0;
  const generationListeners = new Set<() => void>();
  const identity = (definition: object) => {
    let id = identities.get(definition);
    if (id === undefined) {
      id = ++nextId;
      identities.set(definition, id);
    }
    return id;
  };

  // Writes and invalidations inside a batch publish once, and an entry refreshed several
  // times in one batch loads once.
  let depth = 0;
  const staleEntries = new Set<ResourceEntry>();
  const pending = new Set<ResourceEntry>();
  let generationChanged = false;
  const call = (listener: () => void) => {
    try {
      listener();
    } catch (error) {
      reportSafely(reportError, error);
    }
  };
  const batch = (work: () => void) => {
    depth++;
    try {
      work();
    } finally {
      if (depth === 1) {
        try {
          // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners can subscribe or release reentrantly.
          for (const entry of [...staleEntries]) {
            staleEntries.delete(entry);
            if (entry.alive && entry.stale && entry.listeners.size) compute(entry);
          }
          // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners can subscribe or release reentrantly.
          for (const entry of [...pending]) {
            pending.delete(entry);
            // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners can subscribe or release reentrantly.
            for (const listener of [...entry.listeners]) call(listener);
          }
          if (generationChanged) {
            generationChanged = false;
            // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners can subscribe or release reentrantly.
            for (const listener of [...generationListeners]) call(listener);
          }
        } finally {
          depth--;
        }
      } else depth--;
    }
  };
  const publish = (entry: ResourceEntry, state: Result) => {
    entry.state = state;
    if (!entry.listeners.size) return;
    if (depth) pending.add(entry);
    // oxlint-disable-next-line unicorn/no-useless-spread -- Listeners can subscribe or release reentrantly.
    else for (const listener of [...entry.listeners]) call(listener);
  };

  const remember = (entry: ResourceEntry, value: unknown) => {
    entry.loadedAt = clock.currentTimeMillisUnsafe();
    if (entry.alive) entry.value = { value };
  };
  const disposeLifetime = (entry: ResourceEntry) => {
    const lifetime = entry.lifetime;
    entry.lifetime = undefined;
    lifetime?.dispose();
  };
  /** Start this entry's load, keeping the previous success visible while it waits. */
  const compute = (entry: ResourceEntry) => {
    entry.stale = false;
    disposeLifetime(entry);
    entry.revision = ++nextRevision;
    entry.canceled = false;
    const previous = AsyncResult.value(entry.state);
    const scope = Scope.makeUnsafe();
    const completed = Deferred.makeUnsafe<void>();
    const finish = settlement.begin();
    let started = false;
    let stopping = false;
    let fiber: Fiber.Fiber<unknown, unknown> | undefined;
    const lifetime: Lifetime = {
      dispose() {
        stopping = true;
        // Interrupt the load first, then join its finalizers before closing resources,
        // including acquisitions that complete after the interruption.
        if (fiber) Effect.runFork(Fiber.interrupt(fiber));
        Effect.runFork(
          Effect.uninterruptible(
            Effect.gen(function* () {
              if (started) yield* Deferred.await(completed);
              yield* Scope.close(scope, Exit.void);
            }),
          ).pipe(Effect.ensuring(Effect.sync(finish))),
        ).addObserver((exit) => {
          if (Exit.isFailure(exit)) reportSafely(reportError, exit.cause);
        });
      },
    };
    entry.lifetime = lifetime;
    publish(entry, AsyncResult.waitingFrom(Option.some(entry.state)));
    const effect = Effect.suspend(() => {
      if (stopping) return Effect.interrupt;
      started = true;
      return Effect.suspend(() => entry.load()).pipe(
        Effect.map((value) => {
          const shared = Option.isSome(previous)
            ? entry.share(previous.value as Snapshot<unknown>, value)
            : value;
          const snapshot = protectSnapshot(shared);
          if (!disposed && entry.lifetime === lifetime) remember(entry, snapshot);
          return snapshot;
        }),
        Scope.provide(scope),
        Effect.onExit((exit) =>
          (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                Deferred.doneUnsafe(completed, Effect.void);
                // Successful loads retain their resources with the entry.
                if (Exit.isFailure(exit)) finish();
              }),
            ),
          ),
        ),
      );
    });
    fiber = Effect.runFork(effect);
    fiber.addObserver((exit) => {
      // A superseded load never publishes; its result was replaced or discarded.
      if (entry.lifetime !== lifetime) return;
      publish(
        entry,
        Exit.isSuccess(exit)
          ? AsyncResult.success(exit.value)
          : AsyncResult.failureWithPrevious(exit.cause, { previous: Option.some(entry.state) }),
      );
    });
  };
  const evict = (entry: ResourceEntry) => {
    entry.eviction = undefined;
    if (entry.listeners.size || !entry.alive) return;
    entry.alive = false;
    entry.stale = true;
    entry.value = undefined;
    disposeLifetime(entry);
    entry.state = AsyncResult.initial();
  };
  /** Mount the entry; an unobserved entry is evicted once retention elapses. */
  const mount = (entry: ResourceEntry) => {
    if (disposed) return;
    if (!entry.alive) {
      entry.alive = true;
      entry.stale = true;
      entry.state = AsyncResult.initial();
    }
    if (entry.eviction !== undefined) {
      clearTimeout(entry.eviction);
      entry.eviction = undefined;
    }
  };
  const settle = (entry: ResourceEntry) => {
    if (!disposed && entry.alive && !entry.listeners.size && entry.eviction === undefined)
      entry.eviction = setTimeout(() => evict(entry), retention);
  };
  const read = <A = unknown, E = unknown>(entry: TypedResourceEntry<A, E>) => {
    mount(entry);
    if (entry.alive && entry.stale) compute(entry);
    settle(entry);
    return resultOf(entry);
  };
  const subscribe = (entry: ResourceEntry, listener: () => void) => {
    mount(entry);
    entry.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      entry.listeners.delete(listener);
      settle(entry);
    };
  };
  /** Drop the current load; observed entries reload now, others on their next read. */
  const invalidate = (entry: ResourceEntry) => {
    mount(entry);
    if (!entry.stale) {
      entry.stale = true;
      disposeLifetime(entry);
    }
    if (depth) staleEntries.add(entry);
    else if (entry.listeners.size) compute(entry);
    settle(entry);
  };
  const refresh = (entry: ResourceEntry) => {
    entry.revision = ++nextRevision;
    invalidate(entry);
  };
  /** Publish a value instead of loading: the pending load is superseded. */
  const write = (entry: ResourceEntry, state: Result) => {
    batch(() => {
      entry.revision = ++nextRevision;
      invalidate(entry);
      entry.stale = false;
      publish(entry, state);
    });
  };
  const cancel = (entry: ResourceEntry) => {
    entry.canceled = true;
    write(entry, entry.value ? AsyncResult.success(entry.value.value) : AsyncResult.initial());
  };
  const set = (entry: ResourceEntry, value: unknown) => {
    entry.canceled = false;
    mount(entry);
    remember(entry, value);
    write(entry, AsyncResult.success(value));
  };
  const loading = (entry: ResourceEntry) => entry.alive && !entry.stale && entry.state.waiting;

  const acquire = <A, E>(
    key: string,
    load: () => Effect.Effect<A, E, Scope.Scope>,
    share: (previous: Snapshot<A>, next: A | Snapshot<A>) => A | Snapshot<A> = (previous, next) =>
      shareValue(previous, next as Snapshot<A>),
  ) => {
    let entry = resources.get(key);
    if (entry) {
      entry.load = load;
      entry.share = share as ResourceEntry['share'];
    } else {
      entry = {
        key,
        load,
        share: share as ResourceEntry['share'],
        users: 0,
        prefetches: new Set(),
        revision: 0,
        alive: false,
        stale: true,
        state: AsyncResult.initial(),
        listeners: new Set(),
      };
      resources.set(key, entry);
    }
    // Bound definitions as well as cached values. Mounted resources stay shared.
    if (resources.size > 512) {
      for (const [oldKey, old] of resources) {
        if (resources.size <= 512) break;
        if (oldKey !== key && !old.alive) resources.delete(oldKey);
      }
    }
    return entry as TypedResourceEntry<A, E>;
  };
  const checkWritable = () => {
    if (disposed) throw new Error('Cannot write to a disposed query cache.');
  };
  const queryKey = <Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: Args | Snapshot<Args>,
  ) => `query:${identity(definition)}:${encodeQueryArguments(definition, args)}`;
  const acquireQuery = <Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: Args | Snapshot<Args>,
  ) => {
    const config = queryDefinition(definition);
    protectSnapshot(args);
    const entry = acquire(
      queryKey(definition, args),
      () => {
        const effect = Effect.suspend(() =>
          config.load(
            args as Snapshot<Args>,
            resources.get(queryKey(definition, args))?.value?.value as Snapshot<A> | undefined,
          ),
        );
        // Loaders get the cache's services and the scope of the load that owns them.
        return Effect.flatMap(Effect.scope, (scope) =>
          Effect.provideContext(Scope.provide(effect, scope), context),
        );
      },
      config.share,
    );
    entry.query = definition;
    entry.args = args;
    entry.groups = config.groups;
    entry.unused = config.unused ?? options.unused;
    return { entry, config };
  };
  const selectQuery = <Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: Args | Snapshot<Args>,
  ) => {
    const { entry, config } = acquireQuery(definition, args);
    if (entry.canceled && !entry.value) refresh(entry);
    if (
      entry.alive &&
      entry.loadedAt !== undefined &&
      clock.currentTimeMillisUnsafe() - entry.loadedAt >= config.staleTime
    ) {
      if (!read(entry).waiting) refresh(entry);
    }
    return entry;
  };
  const retain = (entry: ResourceEntry) => {
    entry.users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.users--;
      if (!disposed && entry.users === 0 && entry.unused === 'cancel' && loading(entry))
        cancel(entry);
    };
  };
  const abortPrefetches = (entry: ResourceEntry) => {
    // oxlint-disable-next-line unicorn/no-useless-spread -- Cancellation can add or remove observers reentrantly.
    for (const abort of [...entry.prefetches]) abort();
  };
  /** Resolve with the next settled result; Initial waiters are released by cancellation. */
  const awaitResult = <A, E>(entry: TypedResourceEntry<A, E>): Effect.Effect<Snapshot<A>, E> =>
    Effect.callback((resume) => {
      const current = read(entry);
      if (settled(current)) return resume(settledExit(current));
      const stop = subscribe(entry, () => {
        const next = resultOf(entry);
        if (settled(next)) {
          stop();
          resume(settledExit(next));
        }
      });
      return Effect.sync(stop);
    });
  const matching = <Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    selected: [] | [Args | Snapshot<Args>],
  ) =>
    [...resources].filter(
      ([key, entry]) =>
        entry.query === definition &&
        (!selected.length || key === queryKey(definition, selected[0])),
    );
  const cache: QueryCache<R> = {
    batch,
    getQueryData<Args, A, E>(
      definition: Query<Args, A, E, R | Scope.Scope>,
      args: Args | Snapshot<Args>,
    ): Snapshot<A> | undefined {
      return resources.get(queryKey(definition, args))?.value?.value as Snapshot<A> | undefined;
    },
    invalidateGroup(group) {
      batch(() => {
        for (const entry of resources.values()) if (entry.groups?.includes(group)) refresh(entry);
      });
    },
    cancelQuery(definition, ...selected) {
      batch(() => {
        for (const [, entry] of matching(definition, selected))
          if (loading(entry)) {
            abortPrefetches(entry);
            cancel(entry);
          }
      });
    },
    prefetch<Args, A, E>(
      definition: Query<Args, A, E, R | Scope.Scope>,
      args: Args | Snapshot<Args>,
      options?: { readonly refresh?: boolean },
    ): Effect.Effect<Snapshot<A>, E> {
      return Effect.suspend(() => {
        checkWritable();
        const entry = selectQuery(definition, args);
        const release = retain(entry);
        const signal = Deferred.makeUnsafe<never>();
        const abort = () => {
          Deferred.doneUnsafe(signal, Effect.interrupt);
        };
        entry.prefetches.add(abort);
        return Effect.suspend(() => {
          if (options?.refresh && entry.alive && !read(entry).waiting) refresh(entry);
          return Effect.raceFirst(Deferred.await(signal), awaitResult(entry));
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
      definition: Query<Args, A, E, R | Scope.Scope>,
      args: Args | Snapshot<Args>,
      value: A | Snapshot<A>,
    ): Snapshot<A> {
      checkWritable();
      const { entry, config } = acquireQuery(definition, args);
      const previous = entry.value;
      const next = protectSnapshot(value);
      const shared = previous
        ? config.share
          ? config.share(previous.value as Snapshot<A>, next)
          : shareValue(previous.value as Snapshot<A>, next as Snapshot<A>)
        : next;
      const snapshot = protectSnapshot(shared) as Snapshot<A>;
      checkWritable();
      set(entry, snapshot);
      return snapshot;
    },
    updateQueryData<Args, A, E>(
      definition: Query<Args, A, E, R | Scope.Scope>,
      args: Args | Snapshot<Args>,
      update: (previous: Snapshot<A>) => A | Snapshot<A> | undefined,
    ): Snapshot<A> | undefined {
      checkWritable();
      queryDefinition(definition);
      protectSnapshot(args);
      const previous = resources.get(queryKey(definition, args))?.value;
      if (!previous) return undefined;
      const next = update(previous.value as Snapshot<A>);
      return next === undefined ? undefined : cache.setQueryData(definition, args, next);
    },
    invalidateQuery<Args, A, E>(
      definition: Query<Args, A, E, R | Scope.Scope>,
      ...selected: [] | [Args | Snapshot<Args>]
    ) {
      if (selected.length) {
        const entry = resources.get(queryKey(definition, selected[0]));
        if (entry) refresh(entry);
      } else {
        const selected = [...resources.values()].filter((entry) => entry.query === definition);
        batch(() => {
          for (const entry of selected) refresh(entry);
        });
      }
    },
    resetResources() {
      batch(() => {
        for (const entry of resources.values()) {
          abortPrefetches(entry);
          entry.load = () => Effect.interrupt;
          refresh(entry);
        }
        resources.clear();
        generation++;
        generationChanged = true;
      });
    },
    close() {
      if (!closing) {
        closing = Effect.suspend(() => {
          cache.dispose();
          return settlement.wait();
        });
      }
      return closing;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of resources.values()) abortPrefetches(entry);
      for (const entry of resources.values()) {
        if (entry.eviction !== undefined) clearTimeout(entry.eviction);
        entry.eviction = undefined;
        entry.alive = false;
        disposeLifetime(entry);
      }
      resources.clear();
    },
  };
  registerCache(cache, {
    disposed: () => disposed,
    refresh: (entry) => refresh(entry as ResourceEntry),
    revision: (definition, args) => resources.get(queryKey(definition, args))?.revision,
    retain: (entry) => retain(entry as ResourceEntry),
    read: <A, E>(entry: QueryEntry<A, E>) => read(entry as TypedResourceEntry<A, E>),
    subscribe: (entry, listener) => subscribe(entry as ResourceEntry, listener),
    generation: () => generation,
    onGeneration: (listener) => {
      generationListeners.add(listener);
      return () => {
        generationListeners.delete(listener);
      };
    },
    query: <Args, A, E>(
      definition: Query<Args, A, E, R | Scope.Scope>,
      args: Args | Snapshot<Args>,
    ) => selectQuery(definition, args),
  });
  return Object.freeze(cache);
}

/** A cache owns one registry and the query resources published through it. */
export interface QueryCache<R = never> {
  batch(work: () => void): void;
  getQueryData<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
  ): Snapshot<A> | undefined;
  invalidateGroup(group: QueryGroup): void;
  /** Cancel requests while retaining the last success. Explicit refresh restarts them. */
  cancelQuery<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    ...selected: [] | [NoInfer<Args> | Snapshot<NoInfer<Args>>]
  ): void;
  prefetch<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
    options?: { readonly refresh?: boolean },
  ): Effect.Effect<Snapshot<A>, E>;
  /** Publish a protected success, including undefined, and supersede any pending load for this key. */
  setQueryData<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
    value: NoInfer<A> | Snapshot<NoInfer<A>>,
  ): Snapshot<A>;
  /**
   * Update an existing success, including one retained during refresh or failure, and supersede its load.
   * No success or an undefined updater return skips the write. Use setQueryData to seed or store undefined.
   * Updaters run synchronously on readonly data; a throw leaves the cached value unchanged.
   */
  updateQueryData<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    args: NoInfer<Args> | Snapshot<NoInfer<Args>>,
    update: (previous: Snapshot<A>) => NoInfer<A> | Snapshot<NoInfer<A>> | undefined,
  ): Snapshot<A> | undefined;
  invalidateQuery<Args, A, E>(
    definition: Query<Args, A, E, R | Scope.Scope>,
    ...selected: [] | [NoInfer<Args> | Snapshot<NoInfer<Args>>]
  ): void;
  /**
   * Interrupt every request and drop all cached data, for a sign-out or account switch.
   * Observers read Initial until they select again; nothing from the old account is reused.
   */
  resetResources(): void;
  /** Release retained acquisitions and join all load/resource finalizers, including canceled or evicted entries. */
  close(): Effect.Effect<void>;
  dispose(): void;
}
