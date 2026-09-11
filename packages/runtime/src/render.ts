import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Scope from 'effect/Scope';
import { mountViewWithSettlement, unboundSend, type Mounted, type View } from './dom.js';
import type { Source } from './source.js';
import type { Send } from './program.js';
import { makeUiRuntime } from './runtime.js';
import { reportError, reportSafely, type ReportError } from './errors.js';
import { Settlement } from './settlement.js';

/**
 * Mount values or Effect-based view setup in a child resource scope.
 * The surrounding Effect owns the mount; the source keeps its own lifetime.
 */
export function mount<M, Message = never, E = never, R = never>(
  parent: Node,
  definition: View<M, Message> | Effect.Effect<View<M, Message>, E, R>,
  source: Source<M> &
    ([Message] extends [never]
      ? { readonly send?: Send<Message> }
      : { readonly send: Send<Message> }),
  options: { readonly onError?: ReportError } = {},
): Effect.Effect<Mounted, E, R | Scope.Scope> {
  return Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const scope = Scope.makeUnsafe();
        let closingExit: Exit.Exit<unknown, unknown> | undefined;
        const closed = Effect.runSync(
          Effect.cached(
            Effect.uninterruptible(
              Effect.suspend(() => Scope.close(scope, closingExit ?? Exit.void)),
            ),
          ),
        );
        const beginClose = (exit: Exit.Exit<unknown, unknown>) => {
          closingExit ??= exit;
          return closed;
        };
        const close = (exit: Exit.Exit<unknown, unknown>) => Effect.suspend(() => beginClose(exit));
        return { scope, close, beginClose };
      }),
      (lifetime, exit) => lifetime.close(exit),
    );
    return yield* Effect.gen(function* () {
      const runtime = yield* makeUiRuntime();
      const view = Effect.isEffect(definition) ? yield* definition : definition;
      const settlement = new Settlement(runtime);
      // Acquisition can throw after starting child cleanup, before a Mounted exists.
      yield* Effect.addFinalizer(() => settlement.wait());
      const mounted = yield* Effect.acquireRelease(
        Effect.sync(() =>
          mountViewWithSettlement(
            parent,
            view,
            source,
            { ...options, send: source.send ?? (unboundSend as Send<Message>) },
            settlement,
          ),
        ),
        (mounted, exit) =>
          Effect.suspend(() => {
            settlement.exit = exit;
            return mounted.close();
          }),
      );
      const close = lifetime.close(Exit.void);
      const dispose = () => {
        // Claim the exit before user unsubscriptions can reenter application shutdown.
        const closed = lifetime.beginClose(Exit.void);
        mounted.dispose();
        Effect.runFork(closed).addObserver((exit) => {
          if (exit._tag === 'Failure') reportSafely(options.onError ?? reportError, exit.cause);
        });
      };
      return Object.assign(dispose, { dispose, close: () => close });
    }).pipe(
      Scope.provide(lifetime.scope),
      Effect.onError((cause) => lifetime.close(Exit.failCause(cause))),
    );
  });
}
