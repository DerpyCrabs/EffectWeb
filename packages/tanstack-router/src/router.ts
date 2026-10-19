import type { RouterHistory } from '@tanstack/history';
import {
  RouterCore,
  createNonReactiveMutableStore,
  createNonReactiveReadonlyStore,
  type AnyRouter,
  type CreateRouterFn,
} from '@tanstack/router-core';

const publications = new WeakMap<AnyRouter, Set<() => void>>();
const closedRouters = new WeakSet<AnyRouter>();

/** The publication listeners of a router created by this adapter. */
export function routerPublications(router: AnyRouter): Set<() => void> {
  const listeners = publications.get(router);
  if (!listeners) throw new Error('Use @effectweb/tanstack-router.createRouter before mounting');
  return listeners;
}

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
/** Claim the single mount of a router. */
export function claimRouter(router: AnyRouter) {
  if (mountedRouters.has(router)) throw new Error('A router can only be mounted once');
  mountedRouters.add(router);
}
/** Abort the router's running work, release its history and refuse further navigation. */
export function stopRouter(router: AnyRouter) {
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
  const history = router.history as RouterHistory;
  history.flush();
  history.destroy();
}
