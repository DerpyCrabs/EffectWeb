import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import type * as Scope from 'effect/Scope';
import { reportSafely, type ReportError } from './errors.js';
import type { Settlement } from './settlement.js';
import { uiRuntime, type UiRuntime } from './runtime.js';

const tag = Symbol('Effect event');
export interface EffectEventRequest {
  readonly [tag]: true;
  readonly policy: 'drop' | 'replace' | 'parallel';
  readonly effect: Effect.Effect<unknown, unknown, Scope.Scope>;
}

/** Capture/prevent native events on every call; the policy gates only Effect execution. */
export function effectEvent<EventType extends Event, E>(
  policy: 'drop' | 'replace',
  load: (event: EventType) => Effect.Effect<unknown, E, Scope.Scope>,
): (event: EventType) => EffectEventRequest;
export function effectEvent<EventType extends Event, E, R>(
  policy: 'drop' | 'replace',
  load: (event: EventType) => Effect.Effect<unknown, E, R | Scope.Scope>,
  runtime: UiRuntime<R>,
): (event: EventType) => EffectEventRequest;
export function effectEvent<EventType extends Event, E, R>(
  policy: 'drop' | 'replace',
  load: (event: EventType) => Effect.Effect<unknown, E, R | Scope.Scope>,
  runtime?: UiRuntime<R>,
): (event: EventType) => EffectEventRequest {
  return (event) => ({
    [tag]: true,
    policy,
    effect: runtime
      ? runtime.provideScoped(load(event))
      : (load(event) as Effect.Effect<unknown, E, Scope.Scope>),
  });
}

/** Capture an operation's services in Effect setup; its event listener supplies the work scope. */
export const makeEffectHandler = <Args extends readonly unknown[], A, E, R = never>(
  work: (...args: Args) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<(...args: Args) => Effect.Effect<A, E, Scope.Scope>, never, R> =>
  Effect.map(Effect.context<R>(), (context) => {
    const runtime = uiRuntime(context);
    return (...args) => runtime.provideScoped(Effect.suspend(() => work(...args)));
  });

/** Internal listener owner, allocated only when an event returns an owned request. */
export function eventEffects(report: ReportError, settlement?: Settlement) {
  const active = new Set<{ fiber?: Fiber.Fiber<unknown, unknown> }>();
  let disposed = false;
  const stop = () => {
    const previous = [...active];
    active.clear();
    for (const token of previous) if (token.fiber) Effect.runFork(Fiber.interrupt(token.fiber));
  };
  return {
    accept(value: EffectEventRequest | Effect.Effect<unknown, unknown, Scope.Scope>) {
      // Direct Effects admit every event. Other policies are explicit requests.
      const request = Effect.isEffect(value)
        ? { policy: 'parallel' as const, effect: value }
        : value;
      if (disposed) return;
      if (request.policy === 'drop' && active.size) return;
      if (request.policy === 'replace') stop();
      const token: { fiber?: Fiber.Fiber<unknown, unknown> } = {};
      active.add(token);
      const finished = settlement?.begin();
      try {
        const fiber = settlement?.runtime
          ? settlement.runtime.runFork(request.effect)
          : Effect.runFork(Effect.scoped(request.effect));
        token.fiber = fiber;
        fiber.addObserver((exit) => {
          const current = !disposed && active.has(token);
          active.delete(token);
          if (exit._tag === 'Failure' && (current || !Cause.hasInterruptsOnly(exit.cause)))
            reportSafely(report, exit.cause);
          finished?.();
        });
        if (disposed || !active.has(token)) {
          Effect.runFork(Fiber.interrupt(fiber));
        }
      } catch (error) {
        finished?.();
        active.delete(token);
        reportSafely(report, error);
      }
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
