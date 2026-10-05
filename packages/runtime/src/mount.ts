import type { Snapshot } from './snapshot.js';
import { reportError, reportSafely, type ReportError } from './errors.js';
import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Scope from 'effect/Scope';
import * as Exit from 'effect/Exit';
import type { UiRuntime } from './runtime.js';
export { Portal, type PortalProps } from './dom.js';
/** Setup may return nothing, a cleanup, a disposable, or an Effect finalized with the element. */
type Work =
  | void
  | (() => void)
  | { dispose: () => void; update?: () => void }
  | Effect.Effect<unknown, unknown, Scope.Scope>;
export interface DomMount<T extends Element = Element> {
  readonly identity: unknown;
  readonly data: unknown;
  readonly acquire: (element: T, input: () => unknown) => Work;
}
/** Element-owned work. Changed acquisition functions replace and interrupt the prior lifetime. */
export function domMount<T extends Element>(start: (element: T) => Work): DomMount<T> {
  return { identity: start, data: undefined, acquire: (element) => start(element) };
}
/** A stable DOM lifecycle with fresh immutable inputs, for focus, measurements and native events. */
export function domBinding<T extends Element, A>(
  data: A | Snapshot<A>,
  acquire: (element: T, input: () => Snapshot<A>) => Work,
): DomMount<T> {
  return {
    identity: acquire,
    data,
    acquire: (element, input) => acquire(element, input as () => Snapshot<A>),
  };
}

export interface DomHandle<T extends Element> {
  /** Pass as `use={handle.mount}` on exactly one element at a time. */
  readonly mount: DomMount<T>;
  /** The element while it is mounted, for event handlers and controller work. */
  readonly element: () => T | undefined;
}
/**
 * A controller-held reference to one element. There are no refs in views; a handle is declared
 * in the controller, attached with `use`, and read where the controller needs the element.
 * `attached` runs after the element is in the document and may return a cleanup.
 */
export function domHandle<T extends Element>(
  attached?: (element: T) => void | (() => void),
): DomHandle<T> {
  let current: T | undefined;
  const mount = domMount<T>((element) => {
    if (current && current !== element && current.isConnected)
      console.warn(
        'domHandle is mounted on two elements at once; only the latest is readable. Create one handle per element.',
      );
    current = element;
    const cleanup = attached?.(element);
    return () => {
      if (current === element) current = undefined;
      cleanup?.();
    };
  });
  return { mount, element: () => current };
}

/** Allocate the lifetime before acquisition so reentrant publications can update or close it. */
const noCleanup = () => {};
export function prepareMount<T extends Element>(
  element: T,
  mount: DomMount<T>,
  report: ReportError = reportError,
  runtime?: UiRuntime<never>,
) {
  let data = mount.data;
  let work: Exclude<Work, void> | undefined;
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
        // Setup without a cleanup still settles close() through the synchronous release path.
        work = mount.acquire(element, () => data) ?? noCleanup;
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
