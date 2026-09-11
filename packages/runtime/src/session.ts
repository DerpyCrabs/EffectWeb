import type * as Scope from 'effect/Scope';
import type { Snapshot } from './snapshot.js';
import { runAll, reportError, reportSafely } from './errors.js';
import { encodeQueryArguments, type Query } from './query.js';
import type { DisposableOwner } from './owner.js';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import type { QueryCache } from './cache.js';
import { cacheInternals } from './cache-internals.js';

export function lifetime() {
  const cleanups: Array<() => void> = [];
  let disposed = false;
  return {
    add(cleanup: () => void) {
      if (disposed) cleanup();
      else cleanups.push(cleanup);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runAll(cleanups.splice(0).reverse());
    },
    get disposed() {
      return disposed;
    },
  };
}
export type Read<A> = () => A;
export interface SessionContext<R = never> {
  readonly cache: QueryCache<R>;
  readonly changed: () => void;
}

/** One owned selection and immutable observation of a shared query resource. */
export interface QueryResource<Args, A, E = never> {
  select(this: void, args: Args | Snapshot<Args> | undefined): void;
  read(this: void): AsyncResult.AsyncResult<Snapshot<A>, E>;
  subscribe(
    this: void,
    listener: (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void,
  ): () => void;
  refresh(this: void): void;
  dispose(this: void): void;
}

/**
 * Idempotent query reconciliation for snapshot ticks. Freshness is checked when entering a
 * selection (including remount), not on every same-key tick; refresh revalidates unless a request is already in flight.
 */
export function queryResource<Args, A, E, R>(
  context: { cache: QueryCache<R>; changed?: () => void },
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
): QueryResource<Args, A, E> {
  const internal = cacheInternals(context.cache);
  let key: string | undefined;
  let generation = -1;
  let atom: Atom.Atom<AsyncResult.AsyncResult<Snapshot<A>, E>> | undefined;
  let stop: (() => void) | undefined;
  let disposed = false;
  let revision = 0;
  const initial = AsyncResult.initial<Snapshot<A>, E>();
  const listeners = new Set<(result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void>();
  const read = () =>
    atom &&
    !disposed &&
    !internal.disposed() &&
    generation === internal.registry.get(internal.generation)
      ? internal.registry.get(atom)
      : initial;
  let published: AsyncResult.AsyncResult<Snapshot<A>, E> | undefined;
  let notifying = false;
  let pending = false;
  const call = (work: () => void) => {
    try {
      work();
    } catch (error) {
      reportSafely(reportError, error);
    }
  };
  const notify = () => {
    if (disposed) return;
    pending = true;
    if (notifying) return;
    notifying = true;
    try {
      while (pending && !disposed) {
        pending = false;
        if (context.changed) call(context.changed);
        if (disposed) break;
        const result = read();
        if (result === published) continue;
        published = result;
        const selected = revision;
        // A callback may select, reset, refresh or dispose. Finish only the current publication.
        // oxlint-disable-next-line unicorn/no-useless-spread -- Iterate a snapshot because listeners can add or remove subscriptions.
        for (const listener of [...listeners]) {
          if (disposed || selected !== revision || result !== read()) break;
          if (listeners.has(listener)) call(() => listener(result));
        }
      }
    } finally {
      notifying = false;
    }
  };
  const disconnect = () => {
    const release = stop;
    stop = undefined;
    release?.();
  };
  // Initialize before subscribing; construction must not invoke application callbacks.
  internal.registry.get(internal.generation);
  const stopGeneration = internal.registry.subscribe(internal.generation, () => {
    revision++;
    disconnect();
    atom = undefined;
    key = undefined;
    generation = -1;
    notify();
  });
  return {
    select(args: Args | Snapshot<Args> | undefined) {
      if (disposed || internal.disposed()) return;
      const nextGeneration = internal.registry.get(internal.generation);
      const nextKey = args === undefined ? undefined : encodeQueryArguments(definition, args);
      if (nextKey === key && nextGeneration === generation) return;
      const selected = ++revision;
      disconnect();
      // Releasing the previous query can run finalizers that select or dispose again.
      if (disposed || selected !== revision) return;
      key = nextKey;
      generation = nextGeneration;
      const nextAtom = args === undefined ? undefined : internal.query(definition, args);
      if (disposed || selected !== revision) return;
      atom = nextAtom;
      if (nextAtom) {
        // Subscription setup itself can execute a synchronous Effect and reenter selection.
        const releaseUse = internal.retain(nextAtom);
        const unsubscribe = internal.registry.subscribe(nextAtom, notify);
        const release = () => {
          unsubscribe();
          releaseUse();
        };
        if (disposed || selected !== revision) {
          release();
          return;
        }
        stop = release;
      }
      notify();
    },
    read,
    subscribe(listener: (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => {
      if (
        atom &&
        !disposed &&
        !internal.disposed() &&
        generation === internal.registry.get(internal.generation) &&
        !internal.registry.get(atom).waiting
      )
        internal.refresh(atom);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      revision++;
      listeners.clear();
      stopGeneration();
      disconnect();
      atom = undefined;
      key = undefined;
    },
  };
}

export function observeQuery<Args, A, E, R>(
  owner: DisposableOwner,
  cache: QueryCache<R>,
  definition: Query<Args, A, E, NoInfer<R> | Scope.Scope>,
  changed: (result: AsyncResult.AsyncResult<Snapshot<A>, E>) => void,
): QueryResource<Args, A, E> {
  const resource = queryResource({ cache }, definition);
  resource.subscribe(changed);
  return owner.own(resource);
}

/** Application selectors run once per explicit input version, with optional prior output sharing. */
export function projectionCache() {
  let version = 0;
  function select<A>(compute: (previous: A) => A, initial: A): () => A;
  function select<A>(compute: (previous: A | undefined) => A): () => A;
  function select<A>(compute: (previous: A | undefined) => A, initial?: A): () => A {
    let seen = -1,
      value = initial;
    return () => {
      if (seen !== version) {
        value = compute(value);
        seen = version;
      }
      return value!;
    };
  }
  return {
    invalidate: () => {
      version++;
    },
    select,
  };
}

interface OwnedSession {
  dispose(): void;
  refresh?(): void;
  subscribe?(changed: () => void): () => void;
}
export function sessionGroup(sessions: readonly OwnedSession[], changed: () => void) {
  const scope = lifetime();
  for (const session of sessions) scope.add(() => session.dispose());
  try {
    for (const session of sessions) {
      if (session.subscribe) scope.add(session.subscribe(changed));
    }
  } catch (error) {
    scope.dispose();
    throw error;
  }
  return {
    refresh: () => {
      if (!scope.disposed) runAll(sessions.map((session) => () => session.refresh?.()));
    },
    dispose: () => scope.dispose(),
  };
}
