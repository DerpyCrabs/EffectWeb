import {
  BaseRootRoute,
  BaseRoute,
  BaseRouteApi,
  type AnyContext,
  type AnyRoute,
  type AnyRouter,
  type ConstrainLiteral,
  type CreateFileRoute,
  type ErrorComponentProps,
  type FileRoutesByPath,
  type LazyRoute,
  type LazyRouteOptions,
  type NotFoundRouteProps,
  type Register,
  type RegisteredRouter,
  type ResolveFullPath,
  type ResolveId,
  type ResolveParams,
  type RootRoute as RootRouteCore,
  type RootRouteOptions,
  type Route as RouteCore,
  type RouteById,
  type RouteConstraints,
  type RouteIds,
  type RouteOptions,
} from '@tanstack/router-core';
import type { JSX, View } from 'effectweb';
import type { RouteScope } from './view.js';

/** What every route view receives. Augment it with the props layouts pass through `scope.outlet(props)`. */
export interface RouteViewProps {
  readonly scope: RouteScope;
}
/** A route's view; `preload` is present when it was created with `lazyRouteComponent`. */
export type RouteComponent = View<RouteViewProps, never> & {
  readonly preload?: () => Promise<void>;
};
/** The view shown when the route's loader, `beforeLoad` or view fails. `reset` loads the route again. */
export type ErrorRouteComponent = View<RouteViewProps & ErrorComponentProps, never> & {
  readonly preload?: () => Promise<void>;
};
/** The view shown for a `notFound()` thrown in this route or one of its children without a handler. */
export type NotFoundRouteComponent = View<RouteViewProps & NotFoundRouteProps, never>;
/** The root route's shell: it wraps the matched tree and receives it as `children`. */
export type RouteShellComponent = View<RouteViewProps & { readonly children?: JSX.Element }, never>;

declare module '@tanstack/router-core' {
  interface UpdatableRouteOptionsExtensions {
    component?: RouteComponent | undefined;
    errorComponent?: false | null | ErrorRouteComponent | undefined;
    notFoundComponent?: NotFoundRouteComponent | undefined;
    pendingComponent?: RouteComponent | undefined;
  }
  interface RootRouteOptionsExtensions {
    shellComponent?: RouteShellComponent | undefined;
  }
  interface RouterOptionsExtensions {
    defaultComponent?: RouteComponent | undefined;
    defaultErrorComponent?: ErrorRouteComponent | undefined;
    defaultPendingComponent?: RouteComponent | undefined;
    defaultNotFoundComponent?: NotFoundRouteComponent | undefined;
    defaultOnCatch?: ((error: Error) => void) | undefined;
  }
}

/** A route of the tree: TanStack's `BaseRoute` with EffectWeb views in its options. */
export class Route<
  in out TRegister = unknown,
  in out TParentRoute extends RouteConstraints['TParentRoute'] = AnyRoute,
  in out TPath extends RouteConstraints['TPath'] = '/',
  in out TFullPath extends RouteConstraints['TFullPath'] = ResolveFullPath<TParentRoute, TPath>,
  in out TCustomId extends RouteConstraints['TCustomId'] = string,
  in out TId extends RouteConstraints['TId'] = ResolveId<TParentRoute, TCustomId, TPath>,
  in out TSearchValidator = undefined,
  in out TParams = ResolveParams<TPath>,
  in out TRouterContext = AnyContext,
  in out TRouteContextFn = AnyContext,
  in out TBeforeLoadFn = AnyContext,
  in out TLoaderDeps extends Record<string, unknown> = {},
  in out TLoaderFn = undefined,
  in out TChildren = unknown,
  in out TFileRouteTypes = unknown,
  in out TSSR = unknown,
  in out TServerMiddlewares = unknown,
  in out THandlers = undefined,
>
  extends BaseRoute<
    TRegister,
    TParentRoute,
    TPath,
    TFullPath,
    TCustomId,
    TId,
    TSearchValidator,
    TParams,
    TRouterContext,
    TRouteContextFn,
    TBeforeLoadFn,
    TLoaderDeps,
    TLoaderFn,
    TChildren,
    TFileRouteTypes,
    TSSR,
    TServerMiddlewares,
    THandlers
  >
  implements
    RouteCore<
      TRegister,
      TParentRoute,
      TPath,
      TFullPath,
      TCustomId,
      TId,
      TSearchValidator,
      TParams,
      TRouterContext,
      TRouteContextFn,
      TBeforeLoadFn,
      TLoaderDeps,
      TLoaderFn,
      TChildren,
      TFileRouteTypes,
      TSSR,
      TServerMiddlewares,
      THandlers
    > {}

/** The root of a route tree. */
export class RootRoute<
  in out TRegister = unknown,
  in out TSearchValidator = undefined,
  in out TRouterContext = {},
  in out TRouteContextFn = AnyContext,
  in out TBeforeLoadFn = AnyContext,
  in out TLoaderDeps extends Record<string, unknown> = {},
  in out TLoaderFn = undefined,
  in out TChildren = unknown,
  in out TFileRouteTypes = unknown,
  in out TSSR = unknown,
  in out TServerMiddlewares = unknown,
  in out THandlers = undefined,
>
  extends BaseRootRoute<
    TRegister,
    TSearchValidator,
    TRouterContext,
    TRouteContextFn,
    TBeforeLoadFn,
    TLoaderDeps,
    TLoaderFn,
    TChildren,
    TFileRouteTypes,
    TSSR,
    TServerMiddlewares,
    THandlers
  >
  implements
    RootRouteCore<
      TRegister,
      TSearchValidator,
      TRouterContext,
      TRouteContextFn,
      TBeforeLoadFn,
      TLoaderDeps,
      TLoaderFn,
      TChildren,
      TFileRouteTypes,
      TSSR,
      TServerMiddlewares,
      THandlers
    > {}

/** Create a child route; its parent comes from `getParentRoute`. */
export function createRoute<
  TRegister = unknown,
  TParentRoute extends RouteConstraints['TParentRoute'] = AnyRoute,
  TPath extends RouteConstraints['TPath'] = '/',
  TFullPath extends RouteConstraints['TFullPath'] = ResolveFullPath<TParentRoute, TPath>,
  TCustomId extends RouteConstraints['TCustomId'] = string,
  TId extends RouteConstraints['TId'] = ResolveId<TParentRoute, TCustomId, TPath>,
  TSearchValidator = undefined,
  TParams = ResolveParams<TPath>,
  TRouteContextFn = AnyContext,
  TBeforeLoadFn = AnyContext,
  TLoaderDeps extends Record<string, unknown> = {},
  TLoaderFn = undefined,
  TChildren = unknown,
  TSSR = unknown,
  const TServerMiddlewares = unknown,
>(
  options: RouteOptions<
    TRegister,
    TParentRoute,
    TId,
    TCustomId,
    TFullPath,
    TPath,
    TSearchValidator,
    TParams,
    TLoaderDeps,
    TLoaderFn,
    AnyContext,
    TRouteContextFn,
    TBeforeLoadFn,
    TSSR,
    TServerMiddlewares
  >,
): Route<
  TRegister,
  TParentRoute,
  TPath,
  TFullPath,
  TCustomId,
  TId,
  TSearchValidator,
  TParams,
  AnyContext,
  TRouteContextFn,
  TBeforeLoadFn,
  TLoaderDeps,
  TLoaderFn,
  TChildren,
  unknown,
  TSSR,
  TServerMiddlewares
> {
  return new Route(options as never);
}

/** Create the root route. */
export function createRootRoute<
  TRegister = Register,
  TSearchValidator = undefined,
  TRouterContext = {},
  TRouteContextFn = AnyContext,
  TBeforeLoadFn = AnyContext,
  TLoaderDeps extends Record<string, unknown> = {},
  TLoaderFn = undefined,
  TSSR = unknown,
  const TServerMiddlewares = unknown,
  THandlers = undefined,
>(
  options?: RootRouteOptions<
    TRegister,
    TSearchValidator,
    TRouterContext,
    TRouteContextFn,
    TBeforeLoadFn,
    TLoaderDeps,
    TLoaderFn,
    TSSR,
    TServerMiddlewares,
    THandlers
  >,
): RootRoute<
  TRegister,
  TSearchValidator,
  TRouterContext,
  TRouteContextFn,
  TBeforeLoadFn,
  TLoaderDeps,
  TLoaderFn,
  unknown,
  unknown,
  TSSR,
  TServerMiddlewares,
  THandlers
> {
  return new RootRoute(options);
}

/** Create the root route with a typed router context: `createRootRouteWithContext<Context>()(options)`. */
export function createRootRouteWithContext<TRouterContext extends {}>() {
  return <
    TRegister = Register,
    TRouteContextFn = AnyContext,
    TBeforeLoadFn = AnyContext,
    TSearchValidator = undefined,
    TLoaderDeps extends Record<string, unknown> = {},
    TLoaderFn = undefined,
    TSSR = unknown,
    TServerMiddlewares = unknown,
  >(
    options?: RootRouteOptions<
      TRegister,
      TSearchValidator,
      TRouterContext,
      TRouteContextFn,
      TBeforeLoadFn,
      TLoaderDeps,
      TLoaderFn,
      TSSR,
      TServerMiddlewares
    >,
  ) =>
    createRootRoute<
      TRegister,
      TSearchValidator,
      TRouterContext,
      TRouteContextFn,
      TBeforeLoadFn,
      TLoaderDeps,
      TLoaderFn,
      TSSR,
      TServerMiddlewares
    >(options);
}

/**
 * Create a route from a generated route tree: `createFileRoute('/files/$name')(options)`. The
 * TanStack Router generator writes the path types into `FileRoutesByPath`.
 */
export function createFileRoute<
  TFilePath extends keyof FileRoutesByPath,
  TParentRoute extends AnyRoute = FileRoutesByPath[TFilePath]['parentRoute'],
  TId extends RouteConstraints['TId'] = FileRoutesByPath[TFilePath]['id'],
  TPath extends RouteConstraints['TPath'] = FileRoutesByPath[TFilePath]['path'],
  TFullPath extends RouteConstraints['TFullPath'] = FileRoutesByPath[TFilePath]['fullPath'],
>(_path?: TFilePath): CreateFileRoute<TFilePath, TParentRoute, TId, TPath, TFullPath> {
  return ((options?: object) => {
    const route = new Route(options as never);
    (route as { isRoot: boolean }).isRoot = false;
    return route;
  }) as never;
}

/** The view options of a route split into its own module: `createLazyFileRoute('/about')({ component })`. */
export function createLazyFileRoute<
  TFilePath extends keyof FileRoutesByPath,
  TRoute extends AnyRoute = FileRoutesByPath[TFilePath]['preLoaderRoute'],
>(id: TFilePath): (options: LazyRouteOptions) => LazyRoute<TRoute> {
  return (options) => ({ options: { id, ...options } });
}

/** `createLazyFileRoute` for a route tree written by hand, keyed by route id. */
export function createLazyRoute<
  TRouter extends AnyRouter = RegisteredRouter,
  TId extends string = string,
  TRoute extends AnyRoute = RouteById<TRouter['routeTree'], TId>,
>(id: ConstrainLiteral<TId, RouteIds<TRouter['routeTree']>>) {
  return (options: LazyRouteOptions): LazyRoute<TRoute> => ({ options: { id, ...options } });
}

/** Typed access to a route by id from outside its module. */
export function getRouteApi<const TId, TRouter extends AnyRouter = RegisteredRouter>(
  id: ConstrainLiteral<TId, RouteIds<TRouter['routeTree']>>,
) {
  return new BaseRouteApi<TId, TRouter>({ id });
}
