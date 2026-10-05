import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type { RunKey, Program, RunningProgram, Send } from './program.js';
import * as Context from 'effect/Context';
import { mount, type Mounted, type View } from './dom.js';
import { protectSnapshot, type Snapshot } from './snapshot.js';
import type { ReportError } from './errors.js';

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

export interface RenderedView<M, E> extends Mounted {
  /** Publish new props or model, as a parent or program would. */
  readonly update: (next: M | Snapshot<M>) => void;
  /** Messages sent by the view, in order. */
  readonly sent: readonly E[];
}

/**
 * Mount a view or component with fixed input for a test or browser fixture.
 * Messages are recorded in `sent` and forwarded to `options.send`.
 */
export function renderView<M, E = never>(
  parent: Node,
  definition: View<M, E>,
  model: M | Snapshot<M>,
  options: { readonly send?: Send<E>; readonly onError?: ReportError } = {},
): RenderedView<M, E> {
  let current = protectSnapshot(model) as Snapshot<M>;
  const listeners = new Set<(value: Snapshot<M>) => void>();
  const sent: E[] = [];
  const mounted = mount(
    parent,
    definition,
    {
      model: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      send: (message: E) => {
        sent.push(message);
        options.send?.(message);
      },
    },
    options.onError ? { onError: options.onError } : {},
  );
  return Object.assign(() => mounted.dispose(), {
    dispose: mounted.dispose,
    close: mounted.close,
    sent,
    update: (next: M | Snapshot<M>) => {
      current = protectSnapshot(next) as Snapshot<M>;
      for (const listener of listeners) listener(current);
    },
  });
}
