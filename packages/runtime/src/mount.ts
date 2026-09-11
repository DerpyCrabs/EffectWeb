import type { Snapshot } from './snapshot.js';
import { reportError, reportSafely, type ReportError } from './errors.js';
import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import * as Exit from 'effect/Exit';
import { uiRuntime, type UiRuntime } from './runtime.js';
export { Portal, type PortalProps } from './dom.js';
type Work<R = never> =
  | (() => void)
  | { dispose: () => void; update?: () => void }
  | Effect.Effect<unknown, unknown, R | Scope.Scope>;
export interface DomMount<T extends Element = Element> {
  readonly identity: unknown;
  readonly data: unknown;
  readonly acquire: (element: T, input: () => unknown) => Work;
}
/** Element-owned work. Changed acquisition functions replace and interrupt the prior lifetime. */
export function domMount<T extends Element, R = never>(
  start: (element: T) => Work<R>,
  ...provided: [Exclude<R, Scope.Scope>] extends [never]
    ? [runtime?: UiRuntime<R>]
    : [runtime: UiRuntime<R>]
): DomMount<T> {
  const runtime = provided[0];
  return {
    identity: start,
    data: undefined,
    acquire: (element) => {
      const work = start(element);
      return Effect.isEffect(work) && runtime ? runtime.provideScoped(work) : (work as Work);
    },
  };
}
/** A stable DOM lifecycle with fresh immutable inputs, for focus, measurements and native events. */
export function domBinding<T extends Element, A, R = never>(
  data: A | Snapshot<A>,
  acquire: (element: T, input: () => Snapshot<A>) => Work<R>,
  ...provided: [Exclude<R, Scope.Scope>] extends [never]
    ? [runtime?: UiRuntime<R>]
    : [runtime: UiRuntime<R>]
): DomMount<T> {
  return {
    identity: acquire,
    data,
    acquire: (element, input) => {
      const work = acquire(element, input as () => Snapshot<A>);
      const runtime = provided[0];
      return Effect.isEffect(work) && runtime ? runtime.provideScoped(work) : (work as Work);
    },
  };
}

/** Describe a DOM acquisition in Effect setup; services are captured once, resources belong to the element. */
export const makeDomMount = <T extends Element, R = never>(
  start: (element: T) => Work<R>,
): Effect.Effect<DomMount<T>, never, R> =>
  Effect.map(Effect.context<R>(), (context) => {
    const runtime = uiRuntime(context);
    return {
      identity: start,
      data: undefined,
      acquire: (element: T) => {
        const work = start(element);
        return Effect.isEffect(work) ? runtime.provideScoped(work) : work;
      },
    };
  });

/** Capture services once and bind changing inputs without replacing the acquisition lifetime. */
export const makeDomBinding = <T extends Element, A, R = never>(
  acquire: (element: T, input: () => Snapshot<A>) => Work<R>,
): Effect.Effect<(data: A | Snapshot<A>) => DomMount<T>, never, R> =>
  Effect.map(Effect.context<R>(), (context) => {
    const runtime = uiRuntime(context);
    return (data) => ({
      identity: acquire,
      data,
      acquire: (element, input) => {
        const work = acquire(element, input as () => Snapshot<A>);
        return Effect.isEffect(work) ? runtime.provideScoped(work) : work;
      },
    });
  });
/** Allocate the lifetime before acquisition so reentrant publications can update or close it. */
export function prepareMount<T extends Element>(
  element: T,
  mount: DomMount<T>,
  report: ReportError = reportError,
  runtime?: UiRuntime<never>,
) {
  let data = mount.data;
  let work: Work | undefined;
  let fiber: Fiber.Fiber<unknown, unknown> | undefined;
  const resourceScope = Scope.makeUnsafe();
  let started = false;
  let disposed = false;
  let released = false;
  let closingExit: Exit.Exit<unknown, unknown> | undefined;
  let changedDuringSetup = false;
  const completed = Deferred.makeUnsafe<void>();
  const closed = Deferred.await(completed);
  const finish = () => Deferred.doneUnsafe(completed, Effect.void);
  const release = (exit: Exit.Exit<unknown, unknown> = Exit.void) => {
    closingExit ??= exit;
    if (released || work === undefined || (Effect.isEffect(work) && !fiber)) return;
    released = true;
    if (fiber) {
      // Acquisition may finish successfully while its resources remain mounted.
      // Join acquisition before releasing its scope, including async finalizers.
      Effect.runFork(
        Effect.gen(function* () {
          yield* Fiber.interrupt(fiber!);
          yield* Scope.close(resourceScope, closingExit!);
        }),
      ).addObserver((exit) => {
        if (exit._tag === 'Failure') reportSafely(report, exit.cause);
        finish();
      });
    } else {
      try {
        if (typeof work === 'function') work();
        else if ('dispose' in work) work.dispose();
      } finally {
        finish();
      }
    }
  };
  const dispose = (exit: Exit.Exit<unknown, unknown> = Exit.void) => {
    if (disposed) return;
    disposed = true;
    if (!started) finish();
    else release(exit);
  };
  return {
    closed,
    start() {
      if (started || disposed) return;
      started = true;
      try {
        work = mount.acquire(element, () => data);
        if (Effect.isEffect(work)) {
          const acquisition = Scope.provide(work, resourceScope);
          fiber = runtime
            ? runtime.runFork(acquisition)
            : Effect.runFork(Effect.scoped(acquisition));
          fiber.addObserver((exit) => {
            // User reporting may synchronously unmount; retain the acquisition failure first.
            if (exit._tag === 'Failure') closingExit ??= exit;
            if (exit._tag === 'Failure' && (!disposed || !Cause.hasInterruptsOnly(exit.cause)))
              reportSafely(report, exit.cause);
            if (exit._tag === 'Failure') release(exit);
          });
        }
        if (disposed) release();
        else if (changedDuringSetup && !fiber && typeof work === 'object' && 'update' in work)
          work.update?.();
      } catch (error) {
        dispose(Exit.die(error));
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
  runtime?: UiRuntime<never>,
) {
  const lifetime = prepareMount(element, mount, report, runtime);
  lifetime.start();
  return lifetime;
}
