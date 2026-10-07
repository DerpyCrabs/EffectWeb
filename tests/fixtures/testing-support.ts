// A test-only program driver for the runtime's own suites: it runs test Effects with the
// program's services. It is not part of `effectweb/testing`.
import { Context, Effect } from 'effect';
import type { Program, RunKey, RunningProgram } from 'effectweb';

/** Program inspection and controlled Effect execution with application-owned services. */
export interface ProgramDriver<M, Msg, R = never> extends Program<M, Msg> {
  readonly close: RunningProgram<M, Msg>['close'];
  readonly activeKeys: RunningProgram<M, Msg>['activeKeys'];
  readonly awaitKey: (key: RunKey) => Effect.Effect<void>;
  readonly awaitIdle: () => Effect.Effect<void>;
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>;
}

export function programDriver<M, Msg>(source: RunningProgram<M, Msg>): ProgramDriver<M, Msg>;
export function programDriver<M, Msg, R>(
  source: RunningProgram<M, Msg>,
  context: Context.Context<R>,
): ProgramDriver<M, Msg, R>;
export function programDriver<M, Msg, R>(
  source: RunningProgram<M, Msg>,
  context: Context.Context<R> = Context.empty() as Context.Context<R>,
): ProgramDriver<M, Msg, R> {
  return {
    model: source.model,
    send: source.send,
    subscribe: source.subscribe,
    dispose: source.dispose,
    close: source.close,
    activeKeys: source.activeKeys,
    awaitKey: (key: RunKey) => source.awaitIdle(key),
    awaitIdle: () => source.awaitIdle(),
    run: (effect) => Effect.provideContext(effect, context),
  };
}
