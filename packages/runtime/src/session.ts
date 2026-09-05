import { runAll } from './errors.js';
import type { Query } from './query.js';
import type { DisposableOwner } from './owner.js';
import { Cause, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import type { UiLoad, QueryCache } from './cache.js';
import { loadEffect, makePagedResource, type UiPage } from './cache.js';

/** Own subscriptions, DOM adapters and other cleanup for one lifetime. */
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

/** Explicit request selection. Reads are Effect values; no tracking context or reactive props. */
export function resource<A>(context: SessionContext, namespace?: string) {
  let key: string | undefined, atom: Atom.Atom<AsyncResult.AsyncResult<A, unknown>> | undefined;
  let stop: (() => void) | undefined;
  const initial = AsyncResult.initial<A, unknown>();
  return {
    select(selected: string | undefined, load: () => UiLoad<A>) {
      const next =
        selected === undefined
          ? undefined
          : `${context.cache.registry.get(context.cache.generation)}:${selected}`;
      if (next === key) return;
      stop?.();
      stop = undefined;
      key = next;
      atom =
        next === undefined
          ? undefined
          : namespace
            ? context.cache.resource(`${namespace}:${selected}`, load)
            : Atom.make(loadEffect(load)).pipe(Atom.setIdleTTL(0));
      if (atom) stop = context.cache.registry.subscribe(atom, context.changed, { immediate: true });
      context.changed();
    },
    read: () => (atom ? context.cache.registry.get(atom) : initial),
    refresh: () => {
      if (atom) context.cache.registry.refresh(atom);
    },
    dispose: () => {
      stop?.();
      stop = undefined;
      atom = undefined;
      key = undefined;
    },
  };
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
  const initial = AsyncResult.initial<A, E>();
  const listeners = new Set<(result: AsyncResult.AsyncResult<A, E>) => void>();
  const read = () =>
    atom && !disposed && generation === context.cache.registry.get(context.cache.generation)
      ? context.cache.registry.get(atom)
      : initial;
  let published: AsyncResult.AsyncResult<A, E> | undefined;
  const notify = () => {
    if (disposed) return;
    context.changed?.();
    const result = read();
    if (result === published) return;
    published = result;
    // New listeners start with the next publication; removed listeners are skipped.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) if (listeners.has(listener)) listener(result);
  };
  const stopGeneration = context.cache.registry.subscribe(context.cache.generation, () => {
    stop?.();
    stop = undefined;
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
      stop?.();
      stop = undefined;
      key = nextKey;
      generation = nextGeneration;
      atom = args === undefined ? undefined : context.cache.query(definition, args);
      if (atom) stop = context.cache.registry.subscribe(atom, notify, { immediate: true });
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
      disposed = true;
      listeners.clear();
      stopGeneration();
      stop?.();
      stop = undefined;
      atom = undefined;
      key = undefined;
    },
  };
}

/** Publish Effect results directly; the owner releases the subscription on disposal. */
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

export function pagedResource<A, Cursor>(context: SessionContext, itemKey: (item: A) => string) {
  let key: string | undefined,
    page: ReturnType<typeof makePagedResource<A, Cursor>> | undefined,
    stop: (() => void) | undefined;
  const initial = AsyncResult.initial<UiPage<A, Cursor>, unknown>();
  const state = () => (page ? context.cache.registry.get(page.atom) : initial);
  return {
    select(
      selected: string | undefined,
      load: (cursor: Cursor | undefined) => UiLoad<UiPage<A, Cursor>>,
    ) {
      const next =
        selected === undefined
          ? undefined
          : `${context.cache.registry.get(context.cache.generation)}:${selected}`;
      if (next === key) return;
      stop?.();
      stop = undefined;
      key = next;
      page =
        next === undefined ? undefined : makePagedResource(context.cache.registry, load, itemKey);
      if (page)
        stop = context.cache.registry.subscribe(page.atom, context.changed, { immediate: true });
      context.changed();
    },
    snapshot() {
      const result = state(),
        value = Option.getOrUndefined(AsyncResult.value(result));
      return {
        items: value?.items ?? [],
        totalCount: value?.totalCount,
        loading: result.waiting && !value,
        loadingMore: result.waiting && Boolean(value),
        hasMore: value?.next !== undefined,
        error: AsyncResult.isFailure(result) ? String(Cause.squash(result.cause)) : '',
      };
    },
    more: () => page?.more(),
    refresh: () => page?.refresh(),
    dispose: () => {
      stop?.();
      stop = undefined;
      page = undefined;
      key = undefined;
    },
  };
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
/** One declaration owns subscriptions, refresh order and disposal for a group of sessions. */
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
