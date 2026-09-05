import type { Snapshot } from './snapshot.js';
import { Context, Effect, Stream } from 'effect';
import { program, type Command, type RunningProgram, type Transition } from './program.js';

/** A binding to application-owned services, not a new scope or service lifetime. */
export interface UiRuntime<R> {
  readonly context: Context.Context<R>;
  readonly provide: <A, E>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>;
  readonly command: <M>(command: Command<M, R>) => Command<M>;
  readonly program: <M, Msg>(options: {
    initial: M;
    update: (model: Snapshot<M>, message: Msg) => Transition<M, Msg, R>;
    name?: string;
    checkSnapshots?: boolean;
    onDefect?: (cause: unknown) => void;
  }) => RunningProgram<M, Msg>;
}
export function uiRuntime<R>(context: Context.Context<R>): UiRuntime<R> {
  const provide = <A, E>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E> =>
    Effect.provideContext(effect, context);
  const command = <M>(value: Command<M, R>): Command<M> =>
    value.stream
      ? { slot: value.slot, stream: value.stream.pipe(Stream.provideContext(context)) }
      : value.action
        ? { slot: value.slot, action: provide(value.action) }
        : { slot: value.slot, effect: provide(value.effect) };
  return {
    context,
    provide,
    command,
    program: (options) =>
      program({
        ...options,
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
export const defaultUiRuntime = uiRuntime(Context.empty());
