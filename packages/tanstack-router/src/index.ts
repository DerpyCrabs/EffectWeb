export {
  redirect,
  notFound,
  isNotFound,
  isRedirect,
  rootRouteId,
  getElementScrollRestorationEntry,
} from '@tanstack/router-core';
export type {
  AnyRoute,
  AnyRouter,
  AnyRouteMatch,
  ErrorComponentProps,
  FileRoutesByPath,
  LinkOptions,
  MakeRouteMatchUnion,
  MatchRouteOptions,
  NavigateOptions,
  NotFoundError,
  NotFoundRouteProps,
  ParsedLocation,
  Register,
  RegisteredRouter,
  RouteIds,
  RouterState,
  SearchMiddleware,
  ToOptions,
} from '@tanstack/router-core';
export {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  type RouterHistory,
} from '@tanstack/history';
export { createRouter } from './router.js';
export {
  Route,
  RootRoute,
  createRoute,
  createRootRoute,
  createRootRouteWithContext,
  createFileRoute,
  createLazyFileRoute,
  createLazyRoute,
  getRouteApi,
  type RouteViewProps,
  type RouteComponent,
  type ErrorRouteComponent,
  type NotFoundRouteComponent,
  type RouteShellComponent,
} from './route.js';
export { lazyRouteComponent } from './lazy.js';
export {
  canGoBack,
  createRouterController,
  matchRoute,
  mountRouter,
  RouterView,
  type RouterController,
  type RouteScope,
} from './view.js';
export {
  createLink,
  isActiveLocation,
  linkPreloadBinding,
  linkTarget,
  routerLocation,
  type LinkProps,
} from './link.js';
export {
  createBlocker,
  type Blocker,
  type BlockerLocation,
  type BlockerOptions,
  type BlockerState,
  type ShouldBlockArgs,
} from './blocker.js';
