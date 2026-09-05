import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import * as Atom from 'effect/unstable/reactivity/Atom';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';

import { loadEffect, type UiLoad } from './load.js';
import { shareValue } from './share.js';
import type { Query } from './query.js';
import type { UiRuntime } from './runtime.js';
export { loadEffect, type UiLoad } from './load.js';
export { shareValue } from './share.js';

interface ResourceEntry {
  atom: Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>;
  load: () => UiLoad<unknown>;
  loadedAt?: number;
  queryId?: number;
}

export function makeQueryCache(): QueryCache<never>;
export function makeQueryCache<R>(runtime: UiRuntime<R>): QueryCache<R>;
export function makeQueryCache<R>(runtime?: UiRuntime<R>): QueryCache<R> {
  return createQueryCache(runtime);
}

function createQueryCache<R>(runtime?: UiRuntime<R>) {
  const registry = AtomRegistry.make({ defaultIdleTTL: 30_000 });
  const generation = Atom.keepAlive(Atom.make(0));
  const resources = new Map<string, ResourceEntry>();
  const acquire = <A, E>(key: string, load: () => Effect.Effect<A, E>) => {
    let entry = resources.get(key);
    if (entry) entry.load = load;
    else {
      const next: ResourceEntry = {
        load,
        atom: Atom.make((get) => {
          const previous = Option.flatMap(
            get.self<AsyncResult.AsyncResult<unknown, unknown>>(),
            AsyncResult.value,
          );
          return loadEffect(() => next.load()).pipe(
            Effect.map((value) => {
              next.loadedAt = Date.now();
              return Option.isSome(previous) ? shareValue(previous.value, value) : value;
            }),
          );
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
    return { entry, atom: entry.atom as Atom.Atom<AsyncResult.AsyncResult<A, E>> };
  };
  const queryKey = <Args, A, E>(definition: Query<Args, A, E, R>, args: Args) =>
    `query:${definition.id}:${definition.key(args)}`;
  const selectQuery = <Args, A, E>(definition: Query<Args, A, E, R>, args: Args) => {
    const { entry, atom } = acquire(queryKey(definition, args), () => {
      const effect = Effect.suspend(() => definition.load(args));
      return runtime ? runtime.provide(effect) : (effect as Effect.Effect<A, E>);
    });
    entry.queryId = definition.id;
    if (
      registry.getNodes().has(atom) &&
      entry.loadedAt !== undefined &&
      Date.now() - entry.loadedAt >= definition.staleTime
    ) {
      const current = registry.get(atom);
      if (!current.waiting) registry.refresh(atom);
    }
    return atom;
  };
  return {
    registry,
    generation,
    resource<A, E = unknown>(key: string, load: () => Effect.Effect<A, E>) {
      return acquire(key, load).atom;
    },
    query: selectQuery,
    /** Prefetch and views observe the same atom; failure types and shared cancellation remain intact. */
    prefetch<Args, A, E>(definition: Query<Args, A, E, R>, args: Args): Effect.Effect<A, E> {
      return Effect.suspend(() =>
        AtomRegistry.getResult(registry, selectQuery(definition, args), { suspendOnWaiting: true }),
      );
    },
    invalidateQuery<Args, A, E>(definition: Query<Args, A, E, R>, ...selected: [] | [Args]) {
      if (selected.length) {
        const entry = resources.get(queryKey(definition, selected[0]));
        if (entry) registry.refresh(entry.atom);
      } else {
        for (const entry of resources.values())
          if (entry.queryId === definition.id) registry.refresh(entry.atom);
      }
    },
    invalidate(prefix: string) {
      for (const [key, entry] of resources)
        if (key.startsWith(prefix)) registry.refresh(entry.atom);
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
      registry.dispose();
      resources.clear();
    },
  };
}

export type QueryCache<R = never> = ReturnType<typeof createQueryCache<R>>;
