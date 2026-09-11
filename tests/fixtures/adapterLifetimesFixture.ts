import { Deferred, Effect, Fiber, Scope } from 'effect';
import { lazyView, makeUiRuntime, mount } from 'effectweb';

export async function lazyScopeCleanup(root: HTMLElement, explicitRuntime: boolean) {
  const release = Deferred.makeUnsafe<void>();
  let acquired = false;
  let releasing = false;
  let releases = 0;
  let releasedAtClose = false;
  let pending = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* makeUiRuntime<Scope.Scope>();
        const load = () =>
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                acquired = true;
              }),
              () =>
                Effect.gen(function* () {
                  releasing = true;
                  yield* Deferred.await(release);
                  releases++;
                }),
            );
            return yield* Effect.never;
          });
        const definition = explicitRuntime ? lazyView(load, { runtime }) : lazyView(load);
        const mounted = yield* mount(root, definition, {
          model: () => ({}),
          subscribe: () => () => {},
        });
        const closing = Effect.runFork(mounted.close());
        pending = releasing && releases === 0 && closing.pollUnsafe() === undefined;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(closing);
        releasedAtClose = releases === 1;
      }),
    ),
  );
  return { acquired, releases, releasedAtClose, pending };
}
