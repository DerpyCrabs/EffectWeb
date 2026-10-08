import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type { Send } from './program.js';
import { mount, type Mounted, type View } from './dom.js';
import { protectSnapshot } from './snapshot.js';
import type { ReportError } from './errors.js';

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
  readonly update: (next: M) => void;
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
  model: M,
  options: { readonly send?: Send<E>; readonly onError?: ReportError } = {},
): RenderedView<M, E> {
  let current = protectSnapshot(model) as M;
  const listeners = new Set<(value: M) => void>();
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
  return {
    dispose: mounted.dispose,
    close: mounted.close,
    sent,
    update: (next: M) => {
      current = protectSnapshot(next) as M;
      for (const listener of listeners) listener(current);
    },
  };
}
