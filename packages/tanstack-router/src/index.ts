import { Effect, type Scope } from 'effect';
import type { RouterHistory } from '@tanstack/history';
import type { Source } from 'effectweb';
import { projectionSource } from 'effectweb/advanced';
import {
  RouterCore,
  createNonReactiveMutableStore,
  createNonReactiveReadonlyStore,
  type AnyRouter,
  type CreateRouterFn,
  type RouterState,
} from '@tanstack/router-core';
export {
  BaseRoute as Route,
  BaseRootRoute as RootRoute,
  redirect,
  notFound,
} from '@tanstack/router-core';
export { createBrowserHistory, createMemoryHistory } from '@tanstack/history';

// EffectWeb freezes published plain data. Copy it so TanStack can keep managing its mutable match resources.
const snapshotCopy = <Value>(value: Value, seen = new WeakMap<object, unknown>()): Value => {
  if (value === null || typeof value !== 'object') return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  if (seen.has(value)) return seen.get(value) as Value;
  const copy: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' && Array.isArray(value)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if ('value' in descriptor)
      Object.defineProperty(copy, key, {
        value: snapshotCopy(descriptor.value, seen),
        writable: true,
        enumerable: descriptor.enumerable ?? false,
        configurable: true,
      });
  }
  return copy as Value;
};

const publications = new WeakMap<AnyRouter, Set<() => void>>();
const closedRouters = new WeakSet<AnyRouter>();

/** TanStack supplies matching, loaders, search validation and typed navigation; EffectWeb owns publications. */
export const createRouter: CreateRouterFn = (options) => {
  const listeners = new Set<() => void>();
  let batchDepth = 0;
  let dirty = false;
  const publish = () => {
    dirty = true;
    if (batchDepth) return;
    dirty = false;
    for (const listener of listeners) listener();
  };
  const instance = new RouterCore(options, () => ({
    createMutableStore: <Value>(initial: Value) => {
      const store = createNonReactiveMutableStore(initial);
      return {
        get: store.get,
        set: (next: Value | ((previous: Value) => Value)) => {
          store.set((previous) =>
            typeof next === 'function' ? (next as (value: Value) => Value)(previous) : next,
          );
          publish();
        },
      };
    },
    createReadonlyStore: createNonReactiveReadonlyStore,
    batch: (run) => {
      batchDepth++;
      try {
        run();
      } finally {
        batchDepth--;
        if (!batchDepth && dirty) publish();
      }
    },
  }));
  const load = instance.load;
  const navigate = instance.navigate;
  const preload = instance.preloadRoute;
  const closed = () => new Error('Cannot use a disposed router');
  instance.load = (...args) =>
    closedRouters.has(instance) ? Promise.reject(closed()) : load(...args);
  instance.navigate = (...args) =>
    closedRouters.has(instance) ? Promise.reject(closed()) : navigate(...args);
  instance.preloadRoute = (...args) =>
    closedRouters.has(instance) ? Promise.reject(closed()) : preload(...args);
  publications.set(instance, listeners);
  return instance;
};

// Router Core 1.171.34 exposes no public client teardown. Keep this version-specific
// bridge together and cover navigation, beforeLoad and preload cancellation in tests.
const mountedRouters = new WeakSet<AnyRouter>();
function stopRouter(router: AnyRouter) {
  closedRouters.add(router);
  const transaction = router._tx;
  const preflight = router._preflight;
  const flights = [...(router._flights?.values() ?? [])];
  delete router._tx;
  delete router._preflight;
  router._flights?.clear();
  if (router._pending?.[3] !== undefined) clearTimeout(router._pending[3]);
  delete router._pending;
  const rendered = router._rendered;
  delete router._rendered;
  // Revoke write authority before abort handlers can reenter or promises settle.
  rendered?.[1]?.(false);
  preflight?.abort();
  transaction?.[0].abort();
  for (const flight of flights) flight[1].abort();
  router.clearCache();
  router._commitPromise?.resolve();
}

/** Mount once per router in an Effect scope. The returned Source can drive an EffectWeb program or view. */
export const mountRouter = <Router extends AnyRouter>(
  router: Router,
): Effect.Effect<Source<RouterState<Router['routeTree']>>, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const source = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listeners = publications.get(router);
        const history = router.history as RouterHistory;
        if (!listeners)
          throw new Error('Use @effectweb/tanstack-router.createRouter before mountRouter');
        if (mountedRouters.has(router)) throw new Error('A router can only be mounted once');
        mountedRouters.add(router);
        const source = projectionSource<RouterState<Router['routeTree']>>({
          project: () => snapshotCopy(router.state),
        });
        listeners.add(source.changed);
        source.start();
        const unsubscribe = history.subscribe(() => {
          void router
            .load()
            .catch((error: unknown) => console.error('Router navigation failed', error));
        });
        return {
          source,
          dispose: () => {
            unsubscribe();
            listeners.delete(source.changed);
            source.dispose();
            stopRouter(router);
            history.flush();
            history.destroy();
          },
        };
      }),
      (mounted) => Effect.sync(() => mounted.dispose()),
    );
    yield* Effect.tryPromise({
      try: () => router.load(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    return source.source;
  });
export { createLink, linkTarget, type LinkProps } from './link.js';
