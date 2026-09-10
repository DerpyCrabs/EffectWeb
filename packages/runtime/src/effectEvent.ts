import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { reportSafely, type ReportError } from './errors.js';
import type { Settlement } from './settlement.js';
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

/** Internal listener owner, allocated only when an event returns an owned request. */
export function eventEffects(report: ReportError, settlement?: Settlement) {
  let active: { fiber?: Fiber.Fiber<unknown, unknown> } | undefined;
  let disposed = false;
  const stop = () => {
    const previous = active;
    active = undefined;
    if (previous?.fiber) Effect.runFork(Fiber.interrupt(previous.fiber));
  };
  return {
    accept(request: EffectEventRequest) {
      if (disposed) return;
      if (request.policy === 'drop' && active) return;
      stop();
      const token: { fiber?: Fiber.Fiber<unknown, unknown> } = {};
      active = token;
      const finished = settlement?.begin();
      try {
        const fiber = Effect.runFork(request.effect);
        token.fiber = fiber;
        fiber.addObserver((exit) => {
          const current = !disposed && active === token;
          if (current) active = undefined;
          if (exit._tag === 'Failure' && (current || !Cause.hasInterruptsOnly(exit.cause)))
            reportSafely(report, exit.cause);
          finished?.();
        });
        if (disposed || active !== token) {
          Effect.runFork(Fiber.interrupt(fiber));
        }
      } catch (error) {
        finished?.();
        if (active === token) active = undefined;
        reportSafely(report, error);
      }
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
