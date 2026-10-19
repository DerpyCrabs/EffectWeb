import { Context, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { composeMounts, domMount, makeMount, program, view } from 'effectweb';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  mountRouter,
  RouterView,
  type RouteViewProps,
} from '@effectweb/tanstack-router';

export async function packedComposedMounts(parent: HTMLElement) {
  const scope = Scope.makeUnsafe();
  const firstGate = Deferred.makeUnsafe<void>();
  const secondGate = Deferred.makeUnsafe<void>();
  const firstClosing = Deferred.makeUnsafe<void>();
  const secondClosing = Deferred.makeUnsafe<void>();
  const secondFinished = Deferred.makeUnsafe<void>();
  const released: string[] = [];
  const first = domMount(() =>
    Effect.acquireRelease(Effect.void, () =>
      Effect.gen(function* () {
        yield* Deferred.succeed(firstClosing, undefined);
        yield* Deferred.await(firstGate);
        released.push('replaced');
      }),
    ),
  );
  const second = domMount(() =>
    Effect.acquireRelease(Effect.void, () =>
      Effect.gen(function* () {
        yield* Deferred.succeed(secondClosing, undefined);
        yield* Deferred.await(secondGate);
        released.push('current');
        yield* Deferred.succeed(secondFinished, undefined);
      }),
    ),
  );
  const source = program<number, number>({
    initial: 0,
    update: (_model, next) => ({ model: next }),
  });
  const App = view<number>((generation) => (
    <button use={composeMounts([generation === 0 ? first : second])}>composed</button>
  ));
  const mounted = await Effect.runPromise(
    makeMount(parent, App, source).pipe(Scope.provide(scope)),
  );
  source.send(1);
  await Effect.runPromise(Deferred.await(firstClosing));
  const closing = Effect.runFork(mounted.close());
  await Effect.runPromise(Deferred.await(secondClosing));
  const pendingBoth = closing.pollUnsafe() === undefined;
  const detached = parent.childNodes.length === 0;
  await Effect.runPromise(Deferred.succeed(secondGate, undefined));
  await Effect.runPromise(Deferred.await(secondFinished));
  const pendingReplaced = closing.pollUnsafe() === undefined;
  await Effect.runPromise(Deferred.succeed(firstGate, undefined));
  await Effect.runPromise(Fiber.join(closing));
  await Effect.runPromise(Scope.close(scope, Exit.void));
  source.dispose();
  return { pendingBoth, pendingReplaced, detached, released };
}

const service = Context.Reference('packed/composed-runtime', { defaultValue: () => 'missing' });
export async function packedComposedErrors(parent: HTMLElement) {
  const scope = Scope.makeUnsafe();
  const reported = Deferred.makeUnsafe<void>();
  const errors: string[] = [];
  let observed = '';
  const binding = domMount(() =>
    Effect.gen(function* () {
      yield* Effect.yieldNow;
      observed = yield* service;
      return yield* Effect.die(new Error('packed child failed'));
    }),
  );
  const App = view<{}>(() => <div use={composeMounts([binding])} />);
  await Effect.runPromise(
    makeMount(
      parent,
      App,
      {},
      {
        onError: (error) => {
          errors.push(String(error));
          Deferred.doneUnsafe(reported, Effect.void);
        },
      },
    ).pipe(Effect.provideService(service, 'application'), Scope.provide(scope)),
  );
  await Effect.runPromise(Deferred.await(reported));
  await Effect.runPromise(Scope.close(scope, Exit.void));
  return { observed, errors, detached: parent.childNodes.length === 0 };
}

export async function packedRouter(parent: HTMLElement) {
  const scope = Scope.makeUnsafe();
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const root = createRootRoute({
    component: view<RouteViewProps>(({ scope }) => (
      <main data-packed-layout>{scope.outlet({ label: 'nested' })}</main>
    )),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: view<RouteViewProps & { readonly label?: string }>(({ label }) => (
      <p data-packed-home>{label} home</p>
    )),
  });
  const next = createRoute({
    getParentRoute: () => root,
    path: '/next',
    component: view<RouteViewProps & { readonly label?: string }>(({ label }) => (
      <p data-packed-next>{label} next</p>
    )),
  });
  const router = createRouter({
    routeTree: root.addChildren([home, next]),
    history,
    isServer: false,
    origin: 'http://localhost',
  });
  const controller = await Effect.runPromise(mountRouter(router).pipe(Scope.provide(scope)));
  await Effect.runPromise(makeMount(parent, RouterView, { controller }).pipe(Scope.provide(scope)));
  const before = parent.querySelector('main [data-packed-home]')?.textContent;
  const initialPath = controller.source.model().location.pathname;
  let changes = 0;
  const stop = controller.source.subscribe(() => {
    changes++;
  });
  await router.navigate({ to: '/next' });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  const after = parent.querySelector('main [data-packed-next]')?.textContent;
  const finalPath = controller.source.model().location.pathname;
  await Effect.runPromise(Scope.close(scope, Exit.void));
  const changesAtClose = changes;
  let refused = false;
  try {
    await router.navigate({ to: '/' });
  } catch (error) {
    refused = String(error).includes('disposed router');
  }
  stop();
  return {
    before,
    after,
    initialPath,
    finalPath,
    published: changes > 0,
    detached: parent.childNodes.length === 0,
    historySubscriptions: history.subscribers.size,
    refused,
    unchangedAfterClose: changes === changesAtClose,
  };
}
