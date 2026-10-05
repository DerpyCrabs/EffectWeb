import { expect, test } from 'vite-plus/test';
import { Effect } from 'effect';
import {
  createMemoryHistory,
  createRouter,
  linkTarget,
  mountRouter,
  RootRoute,
  Route,
} from './index.js';

test('TanStack matches params, validates search and runs loaders; EffectWeb publishes and cleans up', async () => {
  const history = createMemoryHistory({ initialEntries: ['/files/seed?line=3'] });
  const root = new RootRoute();
  const file = new Route({
    getParentRoute: () => root,
    path: 'files/$name',
    validateSearch: (search: Record<string, unknown>) => ({ line: Number(search.line) || 1 }),
    loaderDeps: ({ search }) => ({ line: search.line }),
    loader: ({ params, deps }) => ({ name: params.name, line: deps.line }),
  });
  const router = createRouter({
    isServer: false,
    origin: 'http://localhost',
    routeTree: root.addChildren([file]),
    history,
  });
  let changes = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* mountRouter(router);
        source.subscribe(() => {
          changes++;
        });
        expect(router.state.matches.at(-1)?.loaderData).toEqual({ name: 'seed', line: 3 });
        yield* Effect.promise(() =>
          router.navigate({ to: '/files/$name', params: { name: 'notes' }, search: { line: 7 } }),
        );
        expect(router.state.location.pathname).toBe('/files/notes');
        expect(router.state.matches.at(-1)?.loaderData).toEqual({ name: 'notes', line: 7 });
        // Allow the EffectWeb publication microtask to flush.
        yield* Effect.promise(() => new Promise<void>((resolve) => queueMicrotask(resolve)));
        expect(changes).toBeGreaterThan(0);
      }),
    ),
  );
  expect(history.subscribers.size).toBe(0);
  const count = changes;
  history.back();
  await Promise.resolve();
  expect(changes).toBe(count);
});

test('linkTarget builds typed hrefs and navigates only on plain clicks', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const root = new RootRoute();
  const file = new Route({ getParentRoute: () => root, path: 'files/$name' });
  const router = createRouter({
    isServer: false,
    origin: 'http://localhost',
    routeTree: root.addChildren([file]),
    history,
  });
  await router.load();
  const target = linkTarget(router, { to: '/files/$name', params: { name: 'a b' } });
  expect(target.href).toBe('/files/a%20b');
  const click = (init: Partial<MouseEvent> = {}) => {
    let prevented = false;
    target.onClick({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: () => {
        prevented = true;
      },
      ...init,
    });
    return prevented;
  };
  expect(click({ ctrlKey: true })).toBe(false);
  expect(click({ button: 1 })).toBe(false);
  expect(history.location.pathname).toBe('/');
  expect(click()).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(history.location.pathname).toBe('/files/a%20b');
  const disabled = linkTarget(router, { to: '/', disabled: true });
  expect(disabled.href).toBeUndefined();
});

test('links preserve external destinations and native download clicks', async () => {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const root = new RootRoute();
  const file = new Route({ getParentRoute: () => root, path: 'files/$name' });
  const router = createRouter({
    isServer: false,
    origin: 'http://localhost',
    routeTree: root.addChildren([file]),
    history,
  });
  await router.load();
  for (const href of ['https://example.com/report?x=1#part', 'mailto:test@example.com']) {
    const target = linkTarget(router, { href });
    expect(target.href).toBe(href);
    let prevented = false;
    target.onClick({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false);
  }
  for (const download of ['', true, 'report.csv'] as const) {
    const target = linkTarget(router, { to: '/files/$name', params: { name: 'report' }, download });
    expect(target.href).toBe('/files/report');
    let prevented = false;
    target.onClick({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false);
  }
  expect(linkTarget(router, { href: 'javascript:alert(1)' }).href).toBeUndefined();
  expect(history.location.pathname).toBe('/');
  const normal = linkTarget(router, {
    to: '/files/$name',
    params: { name: 'normal' },
    download: false,
  });
  normal.onClick({
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(history.location.pathname).toBe('/files/normal');
});

for (const phase of ['loader', 'beforeLoad', 'preload'] as const) {
  test(`closing a router interrupts ${phase} and prevents late commits`, async () => {
    const { Scope, Exit } = await import('effect');
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const root = new RootRoute();
    const wait = ({
      params,
      abortController,
    }: {
      params: { name: string };
      abortController: AbortController;
    }) => {
      if (params.name === 'seed') return;
      signal = abortController.signal;
      began();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    const file = new Route({
      getParentRoute: () => root,
      path: 'files/$name',
      ...(phase === 'beforeLoad' ? { beforeLoad: wait } : { loader: wait }),
    });
    const router = createRouter({
      isServer: false,
      origin: 'http://localhost',
      routeTree: root.addChildren([file]),
      history: createMemoryHistory({ initialEntries: ['/files/seed'] }),
    });
    const scope = Scope.makeUnsafe();
    const source = await Effect.runPromise(mountRouter(router).pipe(Scope.provide(scope)));
    const work =
      phase === 'preload'
        ? router.preloadRoute({ to: '/files/$name', params: { name: 'slow' } })
        : router.navigate({ to: '/files/$name', params: { name: 'slow' } });
    await started;
    await Effect.runPromise(Scope.close(scope, Exit.void));
    const snapshot = source.model();
    expect(signal?.aborted).toBe(true);
    finish();
    await work;
    expect(source.model()).toBe(snapshot);
    expect(router.state.matches.at(-1)?.params).toEqual({ name: 'seed' });
    expect(router.history.subscribers.size).toBe(0);
    await expect(router.load()).rejects.toThrow('disposed router');
    await expect(
      router.navigate({ to: '/files/$name', params: { name: 'again' } }),
    ).rejects.toThrow('disposed router');
    await expect(
      router.preloadRoute({ to: '/files/$name', params: { name: 'again' } }),
    ).rejects.toThrow('disposed router');
  });
}
