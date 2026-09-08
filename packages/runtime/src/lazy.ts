import { Effect, Fiber, type Cause } from 'effect';
import { child, compiled, viewRegion, type View } from './dom.js';
import { reportSafely } from './errors.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

export interface LazyViewOptions<Model, Message, E> {
  readonly pending?: View<Model, Message>;
  readonly failure?: View<{ readonly model: Model; readonly cause: Cause.Cause<E> }, Message>;
}

/**
 * Mount-owned loading with current inputs and a reusable successful definition.
 * Unresolved placements own independent requests; unmount interrupts their work.
 */
export function lazyView<Model, Message = never, E = never, R = never>(
  load: () => Effect.Effect<View<Model, Message>, E, R>,
  ...provided: [R] extends [never]
    ? [
        options?: LazyViewOptions<NoInfer<Model>, NoInfer<Message>, NoInfer<E>> & {
          readonly runtime?: UiRuntime<R>;
        },
      ]
    : [
        options: LazyViewOptions<NoInfer<Model>, NoInfer<Message>, NoInfer<E>> & {
          readonly runtime: UiRuntime<R>;
        },
      ]
): View<Model, Message> {
  const options = provided[0];
  const runtime = options?.runtime ?? (defaultUiRuntime as UiRuntime<R>);
  let loaded: View<Model, Message> | undefined;
  return compiled((scope, parent, before) => {
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
    fiber = Effect.runFork(runtime.provide(Effect.suspend(load)));
    if (scope.disposed) {
      interrupt();
      return;
    }
    fiber.addObserver((exit) => {
      if (scope.disposed) return;
      try {
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
      }
    });
  });
}
