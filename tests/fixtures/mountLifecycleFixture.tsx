import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import {
  makeDomMount,
  mount,
  programView,
  query,
  scopedQueryCache,
  view,
  type Mounted,
} from 'effectweb';

const describeExit = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit)
    ? 'success'
    : Cause.hasInterruptsOnly(exit.cause)
      ? 'interrupted'
      : String(Cause.squash(exit.cause));

export async function failedRenderCleanup(parent: HTMLElement) {
  const order: string[] = [];
  const releaseStarted = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const setup = Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, () =>
      Effect.sync(() => {
        order.push('view dependency');
      }),
    );
    return programView<number, number, never>({
      create: () => ({
        model: () => 0,
        send: () => {},
        subscribe: () => () => {},
        dispose: () => {},
        close: () =>
          Effect.gen(function* () {
            order.push('child release started');
            yield* Deferred.succeed(releaseStarted, undefined);
            yield* Deferred.await(release);
            order.push('child released');
          }),
      }),
      receive: () => {},
      view: view<number>(() => {
        throw new Error('render failed');
      }),
    });
  });
  const mounting = Effect.runFork(
    Effect.scoped(mount(parent, setup, { model: () => 0, subscribe: () => () => {} })),
  );
  await Effect.runPromise(Deferred.await(releaseStarted));
  const whileClosing = [...order];
  const pending = mounting.pollUnsafe() === undefined;
  await Effect.runPromise(Deferred.succeed(release, undefined));
  const result = await Effect.runPromise(Fiber.await(mounting));
  return {
    result: result._tag,
    whileClosing,
    pending,
    after: [...order],
    empty: !parent.childNodes.length,
  };
}

export async function mountClosingExit(
  parent: HTMLElement,
  action: 'close' | 'dispose' | 'reentrant-dispose' | 'failure' | 'interrupt',
) {
  const acquired = Deferred.makeUnsafe<void>();
  const shutdown = Deferred.makeUnsafe<void>();
  const releaseStarted = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const order: string[] = [];
  const exits: Array<{ owner: string; exit: string }> = [];
  let unsubscriptions = 0;
  let mounted: Mounted | undefined;
  const setup = Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, (_, exit) =>
      Effect.sync(() => {
        exits.push({ owner: 'view', exit: describeExit(exit) });
        order.push('view released');
      }),
    );
    const binding = yield* makeDomMount((_element: HTMLButtonElement) =>
      Effect.acquireRelease(Deferred.succeed(acquired, undefined), (_, exit) =>
        Effect.gen(function* () {
          exits.push({ owner: 'DOM', exit: describeExit(exit) });
          order.push('DOM release started');
          yield* Deferred.succeed(releaseStarted, undefined);
          yield* Deferred.await(release);
          order.push('DOM released');
        }),
      ),
    );
    return view<number>(() => <button use={binding}>mounted</button>);
  });
  let application: Fiber.Fiber<never, string>;
  application = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        mounted = yield* mount(parent, setup, {
          model: () => 0,
          subscribe: () => () => {
            unsubscriptions++;
            if (action === 'reentrant-dispose') Effect.runFork(Fiber.interrupt(application));
          },
        });
        if (action === 'failure') {
          yield* Deferred.await(shutdown);
          return yield* Effect.fail('application failed');
        }
        return yield* Effect.never;
      }),
    ),
  );
  await Effect.runPromise(Deferred.await(acquired));
  if (!mounted) throw new Error('Expected the view to be mounted');
  if (action === 'dispose' || action === 'reentrant-dispose') mounted.dispose();
  const close =
    action === 'failure'
      ? Deferred.succeed(shutdown, undefined).pipe(
          Effect.andThen(Fiber.await(application)),
          Effect.asVoid,
        )
      : action === 'interrupt'
        ? Fiber.interrupt(application).pipe(Effect.asVoid)
        : mounted.close();
  const first = Effect.runFork(close);
  await Effect.runPromise(Deferred.await(releaseStarted));
  const second = Effect.runFork(mounted.close());
  const whileClosing = [...order];
  const bothPending = first.pollUnsafe() === undefined && second.pollUnsafe() === undefined;
  const detached = !parent.childNodes.length;
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await Effect.runPromise(Fiber.join(first));
  await Effect.runPromise(Fiber.join(second));
  await Effect.runPromise(Fiber.interrupt(application));
  await Effect.runPromise(mounted.close());
  return { whileClosing, bothPending, detached, after: order, exits, unsubscriptions };
}

export async function queryScopeCleanup() {
  const release = Deferred.makeUnsafe<void>();
  let releasing = false;
  let released = 0;
  const definition = query({
    name: 'packaged-query-scope',
    load: () =>
      Effect.acquireRelease(Effect.succeed(1), () =>
        Effect.gen(function* () {
          releasing = true;
          yield* Deferred.await(release);
          released++;
        }),
      ),
  });
  return await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* scopedQueryCache();
        yield* cache.prefetch(definition, true);
        const retained = !releasing;
        const closing = Effect.runFork(cache.close());
        const pending = closing.pollUnsafe() === undefined;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(closing);
        return { retained, pending, releasedBeforeParentClose: released };
      }),
    ),
  );
}
