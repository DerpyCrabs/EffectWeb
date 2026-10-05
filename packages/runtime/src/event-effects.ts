import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import type * as Scope from 'effect/Scope';
import { reportSafely, type ReportError } from './errors.js';
import type { Settlement } from './settlement.js';

/** Internal listener owner, allocated only when a handler returns an Effect. */
export function eventEffects(report: ReportError, settlement?: Settlement) {
  const active = new Set<{ fiber?: Fiber.Fiber<unknown, unknown> }>();
  let disposed = false;
  const stop = () => {
    const previous = [...active];
    active.clear();
    for (const token of previous) if (token.fiber) Effect.runFork(Fiber.interrupt(token.fiber));
  };
  return {
    /** Every returned Effect runs; work that needs a policy goes through an owner. */
    accept(effect: Effect.Effect<unknown, unknown, Scope.Scope>) {
      if (disposed) return;
      const token: { fiber?: Fiber.Fiber<unknown, unknown> } = {};
      active.add(token);
      const finished = settlement?.begin();
      try {
        const fiber = settlement?.runtime
          ? settlement.runtime.runFork(effect)
          : Effect.runFork(Effect.scoped(effect));
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
