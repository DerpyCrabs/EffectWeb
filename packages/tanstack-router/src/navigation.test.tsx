// @vitest-environment happy-dom
import { expect, test } from 'vite-plus/test';
import { mount, modelOwner, view } from 'effectweb';
import {
  canGoBack,
  createBlocker,
  createLink,
  createMemoryHistory,
  createRouter,
  createRouterController,
  isActiveLocation,
  matchRoute,
  RootRoute,
  Route,
} from './index.js';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
function build(initial = '/') {
  const history = createMemoryHistory({ initialEntries: [initial] });
  const root = new RootRoute();
  const index = new Route({ getParentRoute: () => root, path: '/' });
  const files = new Route({ getParentRoute: () => root, path: 'files' });
  const file = new Route({
    getParentRoute: () => files,
    path: '$name',
    validateSearch: (search: Record<string, unknown>) => ({ line: Number(search.line) || 1 }),
  });
  const router = createRouter({
    isServer: false,
    origin: 'http://localhost',
    routeTree: root.addChildren([index, files.addChildren([file])]),
    history,
    defaultPreload: 'intent',
    defaultPreloadDelay: 0,
  });
  return { router, history };
}

test('links mark themselves active against the current location', async () => {
  const { router } = build('/files/a?line=2');
  const controller = createRouterController(router);
  await controller.start();
  const Link = createLink(router);
  const host = document.createElement('div');
  const App = view(() => (
    <nav>
      <Link to="/files">Files</Link>
      <Link
        to="/files/$name"
        params={{ name: 'a' }}
        search={{ line: 2 }}
        activeOptions={{ exact: true }}
      >
        A
      </Link>
      <Link to="/">Home</Link>
    </nav>
  ));
  const mounted = mount(host, App, modelOwner({}).source);
  await tick();
  const anchors = () => [...host.querySelectorAll('a')].map((a) => a.dataset.status ?? '-');
  expect(anchors()).toEqual(['active', 'active', '-']);
  expect(host.querySelector('a')!.getAttribute('aria-current')).toBe('page');
  await router.navigate({ to: '/' });
  await tick();
  await tick();
  expect(anchors()).toEqual(['-', '-', 'active']);
  mounted.dispose();
  controller.dispose();
});

test('isActiveLocation follows TanStack prefix, exact, search and hash rules', async () => {
  const { router } = build('/files/a?line=2#top');
  await router.load();
  const current = router.state.location;
  const at = (to: string, search?: object, hash?: string) =>
    router.buildLocation({ to, search, hash } as never);
  expect(isActiveLocation(router, current, at('/files'), undefined)).toBe(true);
  expect(isActiveLocation(router, current, at('/files'), { exact: true })).toBe(false);
  expect(isActiveLocation(router, current, at('/fil'), undefined)).toBe(false);
  expect(isActiveLocation(router, current, at('/files/a', { line: 3 }), undefined)).toBe(false);
  expect(
    isActiveLocation(router, current, at('/files/a', { line: 2 }), { includeSearch: false }),
  ).toBe(true);
  expect(
    isActiveLocation(router, current, at('/files/a', { line: 2 }, 'top'), { includeHash: true }),
  ).toBe(true);
  expect(
    isActiveLocation(router, current, at('/files/a', { line: 2 }, 'x'), { includeHash: true }),
  ).toBe(false);
});

test('a link preloads its route on intent through the router', async () => {
  const { router } = build();
  const controller = createRouterController(router);
  await controller.start();
  const preloaded: string[] = [];
  const original = router.preloadRoute;
  router.preloadRoute = ((options: { to?: string }) => {
    preloaded.push(options.to ?? '?');
    return original.call(router, options as never);
  }) as typeof router.preloadRoute;
  const Link = createLink(router);
  const host = document.createElement('div');
  const App = view(() => (
    <div>
      <Link to="/files">Intent</Link>
      <Link to="/files" preload={false}>
        Never
      </Link>
      <Link to="/files" preload="render">
        Render
      </Link>
    </div>
  ));
  const mounted = mount(host, App, modelOwner({}).source);
  await tick();
  await tick();
  expect(preloaded).toEqual(['/files']);
  const [intent, never] = host.querySelectorAll('a');
  intent!.dispatchEvent(new Event('pointerenter'));
  never!.dispatchEvent(new Event('pointerenter'));
  expect(preloaded).toEqual(['/files', '/files']);
  mounted.dispose();
  controller.dispose();
});

test('a blocker with a resolver publishes the pending navigation and honours the decision', async () => {
  const { router, history } = build();
  const controller = createRouterController(router);
  await controller.start();
  const blocker = createBlocker(router, { withResolver: true, enableBeforeUnload: false });
  expect(blocker.source.model().status).toBe('idle');
  // A blocked commit never settles upstream, so blocked navigations are not awaited.
  router.navigate({ to: '/files' }).catch(() => {});
  await tick();
  await tick();
  const blocked = blocker.source.model();
  expect(blocked.status).toBe('blocked');
  if (blocked.status !== 'blocked') throw new Error('expected a blocked navigation');
  expect(blocked.current.routeId).toBe('/');
  expect(blocked.next.routeId).toBe('/files');
  blocked.reset();
  await tick();
  await tick();
  expect(history.location.pathname).toBe('/');
  expect(blocker.source.model().status).toBe('idle');
  const second = router.navigate({ to: '/files' });
  await tick();
  await tick();
  const again = blocker.source.model();
  if (again.status !== 'blocked') throw new Error('expected a blocked navigation');
  again.proceed();
  await second;
  expect(history.location.pathname).toBe('/files');
  blocker.dispose();
  await router.navigate({ to: '/' });
  expect(history.location.pathname).toBe('/');
  controller.dispose();
});

test('a blocker without a resolver decides from shouldBlockFn', async () => {
  const { router, history } = build();
  const controller = createRouterController(router);
  await controller.start();
  const seen: string[] = [];
  const blocker = createBlocker(router, {
    enableBeforeUnload: false,
    shouldBlockFn: ({ next, action }) => {
      seen.push(`${action}:${next.fullPath}`);
      return next.fullPath === '/files';
    },
  });
  router.navigate({ to: '/files' }).catch(() => {});
  await tick();
  await tick();
  expect(history.location.pathname).toBe('/');
  await router.navigate({ to: '/files/$name', params: { name: 'x' } });
  expect(history.location.pathname).toBe('/files/x');
  expect(seen).toEqual(['PUSH:/files', 'PUSH:/files/$name']);
  blocker.dispose();
  controller.dispose();
});

test('matchRoute and canGoBack follow navigations', async () => {
  const { router } = build();
  const controller = createRouterController(router);
  await controller.start();
  const files = matchRoute(controller, { to: '/files/$name' });
  const published: Array<false | Record<string, string>> = [];
  files.subscribe((value) => published.push(value));
  expect(files.model()).toBe(false);
  expect(canGoBack(controller.source.model().location)).toBe(false);
  await router.navigate({ to: '/files/$name', params: { name: 'a' } });
  await tick();
  expect(files.model()).toEqual({ name: 'a' });
  expect(canGoBack(controller.source.model().location)).toBe(true);
  controller.dispose();
});
