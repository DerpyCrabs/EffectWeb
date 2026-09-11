import type { Snapshot } from './snapshot.js';
import * as Context from 'effect/Context';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import type * as Fiber from 'effect/Fiber';
import * as FiberSet from 'effect/FiberSet';
import * as Scope from 'effect/Scope';
import * as Stream from 'effect/Stream';
import { program, type Command, type RunningProgram, type Transition } from './program.js';

/** A binding to application-owned services, not a new scope or service lifetime. */
export interface UiRuntime<R> {
  readonly context: Context.Context<R>;
  readonly clock: Clock.Clock;
  /** Execute work with a fresh resource scope and the captured application context. */
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, R | Scope.Scope>) => Fiber.Fiber<A, E>;
  readonly provide: <A, E>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>;
  /** Supply services while preserving the resource owner's scope. */
  readonly provideScoped: <A, E>(
    effect: Effect.Effect<A, E, R | Scope.Scope>,
  ) => Effect.Effect<A, E, Scope.Scope>;
  readonly command: <M>(command: Command<M, R>) => Command<M>;
  readonly program: <M, Msg>(options: {
    initial: M | Snapshot<M>;
    update: (model: Snapshot<M>, message: Msg) => Transition<M, Msg, R>;
    name?: string;
    onDefect?: (cause: unknown) => void;
  }) => RunningProgram<M, Msg>;
}
export function uiRuntime<R>(context: Context.Context<R>): UiRuntime<R> {
  return createRuntime(context, Effect.runForkWith(context));
}

/** Capture the current Effect environment. The surrounding scope owns all started fibers. */
export const makeUiRuntime = <R = never>(): Effect.Effect<UiRuntime<R>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const fibers = yield* FiberSet.make();
    const run = yield* FiberSet.runtime(fibers)<R>();
    return createRuntime(context, run);
  });

function createRuntime<R>(
  context: Context.Context<R>,
  run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>,
): UiRuntime<R> {
  const provide = <A, E>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
    Effect.provideContext(effect, context);
  const command = <M>(value: Command<M, R>): Command<M> =>
    value.stream
      ? {
          ...value,
          stream: Stream.unwrap(
            Effect.map(Effect.scope, (scope) =>
              value.stream!.pipe(Stream.provideContext(Context.add(context, Scope.Scope, scope))),
            ),
          ),
        }
      : value.action
        ? { ...value, action: provide(Effect.scoped(value.action)) }
        : { ...value, effect: provide(Effect.scoped(value.effect)) };
  return {
    context,
    clock: Context.get(context, Clock.Clock),
    runFork: (effect) => run(Effect.scoped(effect)),
    provide,
    provideScoped: (effect) =>
      Effect.flatMap(Effect.scope, (scope) => provide(Scope.provide(effect, scope))),
    command,
    program: (options) =>
      program({
        ...options,
        runtime: { runFork: (effect) => run(Effect.scoped(effect)) },
        update: (model, message) => {
          const next = options.update(model, message);
          return {
            model: next.model,
            ...(next.cancel ? { cancel: next.cancel } : {}),
            ...(next.commands ? { commands: next.commands.map(command) } : {}),
          };
        },
      }),
  };
}
export const defaultUiRuntime = /* @__PURE__ */ uiRuntime(Context.empty());
