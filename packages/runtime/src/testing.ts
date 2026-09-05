import { Cause, Effect } from 'effect';
import type { RunningProgram } from './program.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

/** Drive the real queue. Test services and TestClock effects use the same supplied context. */
export function programDriver<M, Msg>(
  source: RunningProgram<M, Msg>,
): ReturnType<typeof makeDriver<M, Msg, never>>;
export function programDriver<M, Msg, R>(
  source: RunningProgram<M, Msg>,
  runtime: UiRuntime<R>,
): ReturnType<typeof makeDriver<M, Msg, R>>;
export function programDriver<M, Msg, R>(source: RunningProgram<M, Msg>, runtime?: UiRuntime<R>) {
  return makeDriver(source, runtime ?? (defaultUiRuntime as UiRuntime<R>));
}
function makeDriver<M, Msg, R>(source: RunningProgram<M, Msg>, runtime: UiRuntime<R>) {
  return {
    model: source.model,
    send: source.send,
    subscribe: source.subscribe,
    dispose: source.dispose,
    activeSlots: source.activeSlots,
    awaitSlot: (slot: string) => source.awaitIdle(slot),
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
