import { view } from 'effectweb';
import { renderView } from 'effectweb/testing';
import {
  createLink,
  type ErrorComponentProps,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  createRouterController,
  lazyRouteComponent,
  notFound,
  RouterView,
  type RouteViewProps,
} from '@effectweb/tanstack-router';

export const Lazy = view<RouteViewProps>(() => <p class="lazy">lazy page</p>);

export async function mountRoutes(parent: HTMLElement, initial = '/') {
  const history = createMemoryHistory({ initialEntries: [initial] });
  let release: (() => void) | undefined;
  const root = createRootRoute({
    component: view<RouteViewProps>(({ scope }) => (
      <main>
        <nav>{scope.outlet({ label: 'from root' })}</nav>
      </main>
    )),
    errorComponent: view<RouteViewProps & ErrorComponentProps>(({ error, reset }) => (
      <p class="error" onClick={() => reset()}>
        {String(error)}
      </p>
    )),
    notFoundComponent: view<RouteViewProps>(() => <p class="missing">missing</p>),
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: view<RouteViewProps & { readonly label?: string }>(({ label }) => (
      <p class="home">home {label}</p>
    )),
  });
  const file = createRoute({
    getParentRoute: () => root,
    path: 'files/$name',
    pendingMs: 0,
    pendingComponent: view<RouteViewProps>(() => <p class="pending">loading</p>),
    loader: ({ params }) => {
      if (params.name === 'boom') throw new Error('file exploded');
      if (params.name === 'ghost') throw notFound();
      if (params.name === 'slow')
        return new Promise<{ size: number }>((resolve) => {
          release = () => resolve({ size: 1 });
        });
      return { size: params.name.length };
    },
    component: view<RouteViewProps>(({ scope }) => {
      const match = scope.match.model();
      const params: unknown = match.params;
      if (
        !params ||
        typeof params !== 'object' ||
        !('name' in params) ||
        typeof params.name !== 'string'
      )
        throw new Error('Expected the file route name parameter');
      return (
        <p class="file">
          {params.name}:{(match.loaderData as { size: number }).size}
        </p>
      );
    }),
  });
  const about = createRoute({
    getParentRoute: () => root,
    path: 'about',
    component: lazyRouteComponent(() => import('./routerViewFixture'), 'Lazy'),
  });
  const router = createRouter({
    isServer: false,
    origin: 'http://localhost',
    routeTree: root.addChildren([index, file, about]),
    history,
    defaultPendingMinMs: 0,
  });
  const controller = createRouterController(router);
  await controller.start();
  const Link = createLink(router);
  const App = view<{}>(() => (
    <>
      <RouterView controller={controller} />
      <Link to="/files/$name" params={{ name: 'notes' }} class="to-notes">
        notes
      </Link>
    </>
  ));
  const rendered = renderView(parent, App, {});
  return {
    router,
    controller,
    history,
    release: () => release?.(),
    dispose: () => {
      rendered.dispose();
      controller.dispose();
    },
  };
}

export async function mountOptOutRoutes(
  parent: HTMLElement,
  onParentCatch: (error: unknown) => void,
  onChildCatch: (error: unknown) => void,
) {
  const root = createRootRoute({
    component: view<RouteViewProps>(({ scope }) => scope.outlet()),
    onCatch: onParentCatch,
    errorComponent: view<RouteViewProps & ErrorComponentProps>(({ error }) => (
      <p class="parent-error">{error instanceof Error ? error.message : String(error)}</p>
    )),
  });
  const child = createRoute({
    getParentRoute: () => root,
    path: '/',
    errorComponent: false,
    onCatch: onChildCatch,
    component: view<RouteViewProps>(() => {
      throw new Error('child failed');
    }),
  });
  const router = createRouter({
    isServer: false,
    origin: 'http://localhost',
    routeTree: root.addChildren([child]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    defaultErrorComponent: view<RouteViewProps & ErrorComponentProps>(() => (
      <p class="default-error">default error</p>
    )),
  });
  const controller = createRouterController(router);
  await controller.start();
  const rendered = renderView(parent, RouterView, { controller });
  return () => {
    rendered.dispose();
    controller.dispose();
  };
}
