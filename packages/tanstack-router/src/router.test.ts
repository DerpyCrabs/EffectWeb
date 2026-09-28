import { expect, test } from 'vite-plus/test';
import { Effect } from 'effect';
import { createMemoryHistory, createRouter, mountRouter, RootRoute, Route } from './index.js';

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
