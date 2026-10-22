import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import type { RouterHistory } from '@tanstack/history';
import {
  isNotFound,
  replaceEqualDeep,
  setupScrollRestoration,
  type AnyRoute,
  type AnyRouter,
  type MakeRouteMatchUnion,
  type MatchRouteOptions,
  type NotFoundError,
  type ParsedLocation,
  type RouterState,
  type ToOptions,
} from '@tanstack/router-core';
import { component, errorBoundary, list, mapSource, observe, view, type JSX } from 'effectweb';
import type { Source, View } from 'effectweb';
import { projectionSource } from 'effectweb/advanced';
import { claimRouter, routerPublications, stopRouter } from './router.js';
import type { RouteShellComponent, RouteViewProps } from './route.js';

type Match<Router extends AnyRouter> = MakeRouteMatchUnion<Router>;
type State<Router extends AnyRouter> = RouterState<Router['routeTree']>;
type OutletProps = Omit<RouteViewProps, 'scope'>;
/** The match and location are inputs of the mount so its boundary resets and status views follow them. */
type MountProps = RouteViewProps & {
  readonly match: MakeRouteMatchUnion;
  readonly location: RouterState['location'];
};

/**
 * What a route view knows about its match: the EffectWeb counterpart of TanStack's route hooks.
 * `match` publishes the match's params, search, loader data and status; `outlet()` places the
 * next matched route, with any extra props its view should receive.
 */
export interface RouteScope<Router extends AnyRouter = AnyRouter> {
  readonly router: Router;
  readonly controller: RouterController<Router>;
  readonly match: Source<Match<Router>>;
  readonly location: Source<State<Router>['location']>;
  readonly navigate: Router['navigate'];
  readonly outlet: (props?: OutletProps) => JSX.Element;
}

/**
 * One mounted router: its published state, the scope of each active match and the root outlet.
 * Create it with `createRouterController`, or let `mountRouter` own it inside an Effect scope.
 */
export interface RouterController<Router extends AnyRouter = AnyRouter> {
  readonly router: Router;
  readonly source: Source<State<Router>>;
  /** Load the current location; resolves once its matches are published. Later calls return the same promise. */
  readonly start: () => Promise<void>;
  /** The scope of an active match; the root route's scope is `scope(source.model().matches[0].id)`. */
  readonly scope: (matchId: string) => RouteScope<Router>;
  /** The matched route tree from the root down. `RouterView` renders this. */
  readonly outlet: () => JSX.Element;
  readonly dispose: () => void;
}

// EffectWeb freezes published plain data. Copy it so TanStack can keep managing its mutable match resources.
function snapshotCopy<Value>(value: Value, seen = new WeakMap<object, unknown>()): Value {
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
}

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
const DefaultError = view<{ readonly error: unknown }>(({ error }) => (
  <main role="alert">
    {error instanceof Error ? error.message : 'The page could not be displayed.'}
  </main>
));
const DefaultNotFound = view<object>(() => <main role="alert">Page not found</main>);

const sameIds = (published: readonly string[], expected: readonly string[]) =>
  published.length === expected.length && published.every((id, index) => id === expected[index]);

/**
 * Mount a router outside an Effect: publish its state, follow its history, and render its matches
 * through `outlet()`. Call `start()` once, then `dispose()` when the application ends. Route
 * views receive their `RouteScope` as the `scope` prop.
 */
export function createRouterController<Router extends AnyRouter>(
  router: Router,
): RouterController<Router> {
  claimRouter(router);
  const listeners = routerPublications(router);
  const history = router.history as RouterHistory;
  const scopes = new Map<string, RouteScope<Router>>();
  // A level shows the next match, or the root's not-found view when Router Core planned it there.
  type Level = { readonly id?: string; readonly notFound?: NotFoundError };
  const levels = new Map<string | undefined, Source<Level>>();
  const transitions: Array<{
    readonly ids: readonly string[];
    resolve: (rendered: boolean) => void;
  }> = [];
  let disposed = false;
  let started: Promise<void> | undefined;
  let root: JSX.Element | undefined;
  const matchIds = (state: State<Router>) => state.matches.map((match) => match.id);
  const settle = (published: readonly string[] | undefined) => {
    for (const transition of transitions.splice(0))
      transition.resolve(published !== undefined && sameIds(published, transition.ids));
  };
  const source = projectionSource<State<Router>>({
    project: () => snapshotCopy(router.state),
    reconcile: (previous, next) => replaceEqualDeep(previous, next),
    afterPublish: () => {
      const ids = matchIds(source.model());
      const active = new Set(ids);
      for (const id of scopes.keys()) if (!active.has(id)) scopes.delete(id);
      // A level captures its last projected snapshot; retaining inactive parents retains visited pages.
      for (const id of levels.keys()) if (id !== undefined && !active.has(id)) levels.delete(id);
      settle(ids);
    },
  });
  listeners.add(source.changed);
  source.start();
  // Window and element scroll positions per location, when the router asks for them.
  if (router.options.scrollRestoration && typeof document !== 'undefined')
    setupScrollRestoration(router);
  // Router Core waits for the UI to show the committed matches before it resolves a navigation.
  // The publication microtask is that commit; a transition that publishes nothing settles after it.
  router.startTransition = (run, expected) => {
    run();
    if (disposed) return Promise.resolve(false);
    const ids = expected.map((match) => match.id);
    return new Promise<boolean>((resolve) => {
      const transition = { ids, resolve };
      transitions.push(transition);
      queueMicrotask(() => {
        const index = transitions.indexOf(transition);
        if (index < 0) return;
        transitions.splice(index, 1);
        resolve(!disposed && sameIds(matchIds(source.model()), ids));
      });
    });
  };
  const unsubscribe = history.subscribe(() => {
    void router.load().catch((error: unknown) => console.error('Router navigation failed', error));
  });
  const location = mapSource(source, (state) => state.location);

  const level = (parentId: string | undefined, props: OutletProps = {}): JSX.Element => {
    let active = levels.get(parentId);
    if (!active) {
      active = mapSource(
        source,
        (state): Level => {
          const index =
            parentId === undefined
              ? 0
              : state.matches.findIndex((match) => match.id === parentId) + 1;
          const parent = parentId === undefined ? undefined : state.matches[index - 1];
          if (parent?._notFound) return { notFound: parent.error as NotFoundError };
          const match = parentId !== undefined && index === 0 ? undefined : state.matches[index];
          return match ? { id: match.id } : {};
        },
        (before, next) => before.id === next.id && before.notFound === next.notFound,
      );
      levels.set(parentId, active);
    }
    return observe(active, (level) => {
      if (level.notFound) {
        const scope = controller.scope(parentId!) as unknown as RouteScope;
        const route = (router.routesById as Record<string, AnyRoute>)[
          scope.match.model().routeId as string
        ]!;
        const NotFoundView =
          route.options.notFoundComponent ??
          router.options.defaultNotFoundComponent ??
          DefaultNotFound;
        return (
          <NotFoundView
            {...props}
            scope={scope}
            data={level.notFound.data}
            routeId={level.notFound.routeId as never}
            isNotFound
          />
        );
      }
      return list(level.id === undefined ? [] : [level.id], (id) => {
        const scope = controller.scope(id);
        return observe(scope.location, (location) =>
          observe(scope.match, (match) => (
            <RouteMount
              {...props}
              scope={scope as unknown as RouteScope}
              match={match}
              location={location}
            />
          )),
        );
      });
    });
  };
  const controller: RouterController<Router> = {
    router,
    source,
    start: () => {
      if (disposed) return Promise.reject(new Error('Cannot load a disposed router'));
      return (started ??= router.load());
    },
    scope: (id) => {
      const existing = scopes.get(id);
      if (existing) return existing;
      let last = source.model().matches.find((match) => match.id === id) as
        | Match<Router>
        | undefined;
      if (!last) throw new Error(`Cannot create a scope for inactive route match ${id}`);
      // A removed child's queued notification keeps its last match until its parent disposes it.
      const match = mapSource(source, (state): Match<Router> => {
        last =
          (state.matches.find((value) => value.id === id) as Match<Router> | undefined) ?? last;
        return last!;
      });
      const scope: RouteScope<Router> = {
        router,
        controller,
        match,
        location,
        navigate: router.navigate,
        outlet: (props) => level(id, props),
      };
      scopes.set(id, scope);
      return scope;
    },
    outlet: () => (root ??= level(undefined)),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      listeners.delete(source.changed);
      source.dispose();
      settle(undefined);
      scopes.clear();
      levels.clear();
      stopRouter(router);
    },
  };
  return controller;
}

/** Mount a router inside an Effect scope and load the current location. The scope disposes it. */
export function mountRouter<Router extends AnyRouter>(
  router: Router,
): Effect.Effect<RouterController<Router>, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => createRouterController(router)),
      (mounted) => Effect.sync(() => mounted.dispose()),
    );
    yield* Effect.tryPromise({
      try: () => controller.start(),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    return controller;
  });
}

/** The matched route tree of a controller. Place it once at the application root. */
export const RouterView = view<{ readonly controller: RouterController }>(({ controller }) =>
  controller.outlet(),
);

/** A route's view, pending view, error and not-found fallbacks, resolved once per match. */
function routeBoundary(scope: RouteScope): View<MountProps, never> {
  const router = scope.router;
  const routes = router.routesById as Record<string, AnyRoute>;
  const route = routes[scope.match.model().routeId as string]!;
  const options = route.options;
  const content = view<MountProps>(({ match, location: _location, ...props }) => {
    if (match.status === 'error' || match.status === 'notFound') throw match.error;
    if (match.status === 'pending') {
      const Pending = options.pendingComponent ?? router.options.defaultPendingComponent;
      return Pending ? <Pending {...props} /> : null;
    }
    const Definition = options.component ?? router.options.defaultComponent;
    if (Definition) return <Definition {...props} />;
    const { scope: _scope, ...rest } = props;
    return props.scope.outlet(rest);
  });
  const ErrorView = options.errorComponent ?? router.options.defaultErrorComponent;
  const NotFoundView =
    options.notFoundComponent ??
    (route.isRoot ? router.options.defaultNotFoundComponent : undefined);
  const onCatch = options.onCatch ?? router.options.defaultOnCatch;
  const bounded = errorBoundary(content, {
    // Retry after a navigation or `router.invalidate()` replaced the match.
    reset: (model) => `${model.location.href}\n${model.match.updatedAt}\n${model.match.status}`,
    onError: (error) => {
      if (!isNotFound(error) && (ErrorView || route.isRoot)) onCatch?.(toError(error));
    },
    fallback: view(({ model: { match: _match, location: _location, ...model }, error }) => {
      if (isNotFound(error)) {
        const notFound = error as NotFoundError;
        notFound.routeId ??= route.id as never;
        // A not-found for another route, or without a handler here, continues to the parent.
        if (!NotFoundView || (notFound.routeId && notFound.routeId !== route.id)) {
          if (route.isRoot && !NotFoundView) return <DefaultNotFound />;
          throw error;
        }
        return (
          <NotFoundView
            {...model}
            data={notFound.data}
            routeId={notFound.routeId as never}
            isNotFound
          />
        );
      }
      if (!ErrorView) {
        if (!route.isRoot) throw error;
        return <DefaultError error={error} />;
      }
      return (
        <ErrorView
          {...model}
          error={toError(error)}
          reset={() => {
            router.invalidate().catch((cause: unknown) => console.error(cause));
          }}
        />
      );
    }),
  });
  const Shell = route.isRoot
    ? (options as { readonly shellComponent?: RouteShellComponent }).shellComponent
    : undefined;
  const Bounded = bounded;
  return Shell
    ? view<MountProps>(({ match, location, ...props }) => (
        <Shell {...props}>
          <Bounded {...props} match={match} location={location} />
        </Shell>
      ))
    : bounded;
}
// One boundary per match placement: the fallback and its reset survive match publications.
const RouteMount = component(
  { init: (props: MountProps) => ({ boundary: routeBoundary(props.scope) }) },
  view(({ boundary: Boundary, props }) => <Boundary {...props} />),
);

/** Whether the current history entry has an earlier entry in this session to go back to. */
export const canGoBack = (location: ParsedLocation) =>
  (location.state as { __TSR_index?: number }).__TSR_index !== 0;

/**
 * Whether a destination matches the current (or pending) location, as a source: the
 * matched params, or `false`. The counterpart of TanStack's `useMatchRoute`.
 */
export function matchRoute<Router extends AnyRouter>(
  controller: RouterController<Router>,
  to: ToOptions<Router>,
  options?: MatchRouteOptions,
): Source<false | Record<string, string>> {
  return mapSource(
    controller.source,
    () => controller.router.matchRoute(to as never, options) as false | Record<string, string>,
    (previous, next) =>
      previous === next ||
      (previous !== false &&
        next !== false &&
        Object.keys(previous).length === Object.keys(next).length &&
        Object.keys(previous).every((key) => previous[key] === next[key])),
  );
}
