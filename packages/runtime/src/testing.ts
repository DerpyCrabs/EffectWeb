import { Cause, Effect } from 'effect';
import type { CommandSlot, Program, RunningProgram } from './program.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

/** Program inspection and controlled Effect execution with application-owned services. */
export interface ProgramDriver<M, Msg, R = never> extends Program<M, Msg> {
  readonly activeSlots: RunningProgram<M, Msg>['activeSlots'];
  readonly awaitSlot: (slot: CommandSlot) => Promise<void>;
  readonly awaitIdle: () => Promise<void>;
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

export function programDriver<M, Msg>(source: RunningProgram<M, Msg>): ProgramDriver<M, Msg>;
export function programDriver<M, Msg, R>(
  source: RunningProgram<M, Msg>,
  runtime: UiRuntime<R>,
): ProgramDriver<M, Msg, R>;
export function programDriver<M, Msg, R>(
  source: RunningProgram<M, Msg>,
  runtime?: UiRuntime<R>,
): ProgramDriver<M, Msg, R> {
  return makeDriver(source, runtime ?? (defaultUiRuntime as UiRuntime<R>));
}
function makeDriver<M, Msg, R>(
  source: RunningProgram<M, Msg>,
  runtime: UiRuntime<R>,
): ProgramDriver<M, Msg, R> {
  return {
    model: source.model,
    send: source.send,
    subscribe: source.subscribe,
    dispose: source.dispose,
    activeSlots: source.activeSlots,
    awaitSlot: (slot: CommandSlot) => source.awaitIdle(slot),
    awaitIdle: () => source.awaitIdle(),
    run: <A, E>(effect: Effect.Effect<A, E, R>) => Effect.runPromise(runtime.provide(effect)),
  };
}

/** A reusable controlled request, with cancellation visible to tests. No renderer or private messages. */
export function controlledEffect<A, E = never>() {
  const pending = new Set<(effect: Effect.Effect<A, E>) => void>();
  let canceled = 0;
  const effect = Effect.callback<A, E>((resume) => {
    pending.add(resume);
    return Effect.sync(() => {
      pending.delete(resume);
      canceled++;
    });
  });
  const settle = (result: Effect.Effect<A, E>) => {
    const resume = pending.values().next().value;
    if (!resume) throw new Error('No controlled request is pending');
    pending.delete(resume);
    resume(result);
  };
  return {
    effect,
    pending: () => pending.size,
    canceled: () => canceled,
    succeed: (value: A) => settle(Effect.succeed(value)),
    fail: (error: E) => settle(Effect.fail(error)),
    die: (defect: unknown) => settle(Effect.failCause(Cause.die(defect))),
  };
}
