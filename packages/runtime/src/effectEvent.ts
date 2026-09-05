import { Effect, Fiber } from 'effect';
import { reportSafely, type ReportError } from './errors.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

const tag = Symbol('Effect event');
export interface EffectEventRequest {
  readonly [tag]: true;
  readonly policy: 'drop' | 'replace';
  readonly effect: Effect.Effect<unknown, unknown>;
}

/** Capture/prevent native events on every call; the policy gates only Effect execution. */
export function effectEvent<EventType extends Event, E>(
  policy: 'drop' | 'replace',
  load: (event: EventType) => Effect.Effect<unknown, E>,
): (event: EventType) => EffectEventRequest;
export function effectEvent<EventType extends Event, E, R>(
  policy: 'drop' | 'replace',
  load: (event: EventType) => Effect.Effect<unknown, E, R>,
  runtime: UiRuntime<R>,
): (event: EventType) => EffectEventRequest;
export function effectEvent<EventType extends Event, E, R>(
  policy: 'drop' | 'replace',
  load: (event: EventType) => Effect.Effect<unknown, E, R>,
  runtime?: UiRuntime<R>,
): (event: EventType) => EffectEventRequest {
  const owner = runtime ?? (defaultUiRuntime as UiRuntime<R>);
  return (event) => ({ [tag]: true, policy, effect: owner.provide(load(event)) });
}

/** Internal listener owner, allocated only when an event returns a value needing inspection. */
export function eventEffects(report: ReportError) {
  let active: { fiber?: Fiber.Fiber<unknown, unknown> } | undefined;
  let disposed = false;
  const stop = () => {
    const previous = active;
    active = undefined;
    if (previous?.fiber) Effect.runFork(Fiber.interrupt(previous.fiber));
  };
  return {
    accept(value: unknown) {
      if (disposed) return;
      if (value && typeof value === 'object' && tag in value) {
        const request = value as EffectEventRequest;
        if (request.policy === 'drop' && active) return;
        stop();
        const token: { fiber?: Fiber.Fiber<unknown, unknown> } = {};
        active = token;
        try {
          const fiber = Effect.runFork(request.effect);
          token.fiber = fiber;
          if (disposed || active !== token) {
            Effect.runFork(Fiber.interrupt(fiber));
            return;
          }
          fiber.addObserver((exit) => {
            if (disposed || active !== token) return;
            active = undefined;
            if (exit._tag === 'Failure') reportSafely(report, exit.cause);
          });
        } catch (error) {
          if (active === token) active = undefined;
          reportSafely(report, error);
        }
      } else if (Effect.isEffect(value)) {
        reportSafely(
          report,
          new Error(
            'Event returned an unowned Effect. Use effectEvent(policy, factory) or dispatch a command.',
          ),
        );
      } else if (
        value &&
        typeof value === 'object' &&
        'then' in value &&
        typeof value.then === 'function'
      ) {
        void Promise.resolve(value as PromiseLike<unknown>).catch((error) =>
          reportSafely(report, error),
        );
        reportSafely(
          report,
          new Error(
            'Event returned an unowned Promise. Adapt it with fromPromise inside effectEvent or a command.',
          ),
        );
      }
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
