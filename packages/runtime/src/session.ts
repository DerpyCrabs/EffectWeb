import { runAll, reportError, reportSafely } from './errors.js';
import type { Query } from './query.js';
import type { DisposableOwner } from './owner.js';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import type { QueryCache } from './cache.js';

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

/**
 * Idempotent query reconciliation for snapshot ticks. Freshness is checked when entering a
 * selection (including remount), not on every same-key tick; refresh revalidates unless a request is already in flight.
 */
export function queryResource<Args, A, E, R>(
  context: { cache: QueryCache<R>; changed?: () => void },
  definition: Query<Args, A, E, NoInfer<R>>,
) {
  let key: string | undefined;
  let generation = -1;
  let atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | undefined;
  let stop: (() => void) | undefined;
  let disposed = false;
  let revision = 0;
  const initial = AsyncResult.initial<A, E>();
  const listeners = new Set<(result: AsyncResult.AsyncResult<A, E>) => void>();
  const read = () =>
    atom && !disposed && generation === context.cache.registry.get(context.cache.generation)
      ? context.cache.registry.get(atom)
      : initial;
  let published: AsyncResult.AsyncResult<A, E> | undefined;
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
        // oxlint-disable-next-line unicorn/no-useless-spread
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
  context.cache.registry.get(context.cache.generation);
  const stopGeneration = context.cache.registry.subscribe(context.cache.generation, () => {
    revision++;
    disconnect();
    atom = undefined;
    key = undefined;
    generation = -1;
    notify();
  });
  return {
    select(args: Args | undefined) {
      if (disposed) return;
      const nextGeneration = context.cache.registry.get(context.cache.generation);
      const nextKey = args === undefined ? undefined : definition.key(args);
      if (nextKey === key && nextGeneration === generation) return;
      const selected = ++revision;
      disconnect();
      key = nextKey;
      generation = nextGeneration;
      const nextAtom = args === undefined ? undefined : context.cache.query(definition, args);
      if (disposed || selected !== revision) return;
      atom = nextAtom;
      if (nextAtom) {
        // Subscription setup itself can execute a synchronous Effect and reenter selection.
        const release = context.cache.registry.subscribe(nextAtom, notify);
        if (disposed || selected !== revision) {
          release();
          return;
        }
        stop = release;
      }
      notify();
    },
    read,
    subscribe(listener: (result: AsyncResult.AsyncResult<A, E>) => void) {
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
        generation === context.cache.registry.get(context.cache.generation) &&
        !context.cache.registry.get(atom).waiting
      )
        context.cache.registry.refresh(atom);
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
  definition: Query<Args, A, E, NoInfer<R>>,
  changed: (result: AsyncResult.AsyncResult<A, E>) => void,
) {
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
  for (const session of sessions) {
    scope.add(() => session.dispose());
    if (session.subscribe) scope.add(session.subscribe(changed));
  }
  return {
    refresh: () => {
      if (!scope.disposed) runAll(sessions.map((session) => () => session.refresh?.()));
    },
    dispose: () => scope.dispose(),
  };
}
