import type { Snapshot } from './snapshot.js';
import { reportError, reportSafely, type ReportError } from './errors.js';
import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';
export { Portal, type PortalProps } from './dom.js';
type Work<R = never> =
  | (() => void)
  | { dispose: () => void; update?: () => void }
  | Effect.Effect<never, unknown, R>;
export interface DomMount<T extends Element = Element> {
  readonly identity: unknown;
  readonly data: unknown;
  readonly acquire: (element: T, input: () => unknown) => Work;
}
/** Element-owned work. Changed acquisition functions replace and interrupt the prior lifetime. */
export function domMount<T extends Element, R = never>(
  start: (element: T) => Work<R>,
  ...provided: [R] extends [never] ? [runtime?: UiRuntime<R>] : [runtime: UiRuntime<R>]
): DomMount<T> {
  const runtime = provided[0] ?? (defaultUiRuntime as UiRuntime<R>);
  return {
    identity: start,
    data: undefined,
    acquire: (element) => {
      const work = start(element);
      return Effect.isEffect(work) ? runtime.provide(work) : work;
    },
  };
}
/** A stable DOM lifecycle with fresh immutable inputs, for focus, measurements and native events. */
export function domBinding<T extends Element, A, R = never>(
  data: A | Snapshot<A>,
  acquire: (element: T, input: () => Snapshot<A>) => Work<R>,
  ...provided: [R] extends [never] ? [runtime?: UiRuntime<R>] : [runtime: UiRuntime<R>]
): DomMount<T> {
  return {
    identity: acquire,
    data,
    acquire: (element, input) => {
      const work = acquire(element, input as () => Snapshot<A>);
      const runtime = provided[0] ?? (defaultUiRuntime as UiRuntime<R>);
      return Effect.isEffect(work) ? runtime.provide(work) : work;
    },
  };
}
/** Allocate the lifetime before acquisition so reentrant publications can update or close it. */
export function prepareMount<T extends Element>(
  element: T,
  mount: DomMount<T>,
  report: ReportError = reportError,
) {
  let data = mount.data;
  let work: Work | undefined;
  let fiber: Fiber.Fiber<never, unknown> | undefined;
  let started = false;
  let disposed = false;
  let released = false;
  let changedDuringSetup = false;
  const completed = Deferred.makeUnsafe<void>();
  const closed = Deferred.await(completed);
  const finish = () => Deferred.doneUnsafe(completed, Effect.void);
  const release = () => {
    if (released || work === undefined || (Effect.isEffect(work) && !fiber)) return;
    released = true;
    if (fiber) Effect.runFork(Fiber.interrupt(fiber));
    else {
      try {
        if (typeof work === 'function') work();
        else if ('dispose' in work) work.dispose();
      } finally {
        finish();
      }
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!started) finish();
    else release();
  };
  return {
    closed,
    start() {
      if (started || disposed) return;
      started = true;
      try {
        work = mount.acquire(element, () => data);
        if (Effect.isEffect(work)) {
          fiber = Effect.runFork(work);
          fiber.addObserver((exit) => {
            if (exit._tag === 'Failure' && (!disposed || !Cause.hasInterruptsOnly(exit.cause)))
              reportSafely(report, exit.cause);
            finish();
          });
        }
        if (disposed) release();
        else if (changedDuringSetup && !fiber && typeof work === 'object' && 'update' in work)
          work.update?.();
      } catch (error) {
        dispose();
        if (work === undefined) finish();
        throw error;
      }
    },
    close: () =>
      Effect.suspend(() => {
        dispose();
        return closed;
      }),
    update(next: DomMount<T>) {
      if (disposed || next.identity !== mount.identity) return false;
      data = next.data;
      if (started && work === undefined) changedDuringSetup = true;
      else if (!fiber && typeof work === 'object' && work && 'update' in work) work.update?.();
      return true;
    },
    dispose,
  };
}
export function startMount<T extends Element>(
  element: T,
  mount: DomMount<T>,
  report: ReportError = reportError,
) {
  const lifetime = prepareMount(element, mount, report);
  lifetime.start();
  return lifetime;
}
