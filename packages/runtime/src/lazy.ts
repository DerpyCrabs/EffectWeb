import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Fiber from 'effect/Fiber';
import { child, compiled, viewRegion, type View } from './dom.js';
import { reportSafely } from './errors.js';
import { defaultUiRuntime } from './runtime.js';

export interface LazyViewOptions<Model, Message, E> {
  readonly pending?: View<Model, Message>;
  readonly failure?: View<{ readonly model: Model; readonly cause: Cause.Cause<E> }, Message>;
}

/**
 * Mount-owned loading with current inputs and a reusable successful definition.
 * Unresolved placements own independent requests; unmount interrupts their work.
 */
export function lazyView<Model, Message = never, E = never>(
  load: () => Effect.Effect<View<Model, Message>, E, Scope.Scope>,
  options?: LazyViewOptions<NoInfer<Model>, NoInfer<Message>, NoInfer<E>>,
): View<Model, Message> {
  let loaded: View<Model, Message> | undefined;
  return compiled((scope, parent, before) => {
    const runtime = scope.settlement.runtime ?? defaultUiRuntime;
    const render = viewRegion(scope, parent, before);
    if (loaded) {
      render(loaded);
      return;
    }
    render(options?.pending);
    let fiber: Fiber.Fiber<View<Model, Message>, E> | undefined;
    const interrupt = () => {
      if (fiber) Effect.runFork(Fiber.interrupt(fiber));
    };
    scope.cleanups.push(interrupt);
    if (scope.disposed) return;
    const finished = scope.settlement.begin();
    try {
      fiber = runtime.runFork(Effect.suspend(load));
    } catch (error) {
      finished();
      throw error;
    }
    fiber.addObserver((exit) => {
      try {
        if (scope.disposed) {
          if (exit._tag === 'Failure' && !Cause.hasInterruptsOnly(exit.cause))
            reportSafely(scope.report, exit.cause);
          return;
        }
        if (exit._tag === 'Success') {
          loaded = exit.value;
          render(loaded);
        } else {
          const failure = options?.failure;
          if (failure)
            render(
              compiled((scope, parent, before) => {
                child(
                  scope,
                  parent,
                  before,
                  failure,
                  () => [scope.value],
                  () => ({ model: scope.value, cause: exit.cause }),
                  scope.send,
                );
              }),
            );
          else {
            render(undefined);
            reportSafely(scope.report, exit.cause);
          }
        }
      } catch (error) {
        reportSafely(scope.report, error);
      } finally {
        finished();
      }
    });
    if (scope.disposed) interrupt();
  });
}
