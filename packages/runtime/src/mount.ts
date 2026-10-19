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
/**
 * A DOM lifecycle that follows changing data. Setup runs once; return `{ update, dispose }` and
 * read the current data through `input()` in `update`, or read `input()` inside the handlers it
 * adds. A value read into a variable during setup never changes (EW3008).
 */
export function domBinding<T extends Element, A>(
  data: A,
  acquire: (element: T, input: () => A) => Work,
): DomMount<T> {
  return {
    identity: acquire,
    data,
    acquire: (element, input) => acquire(element, input as () => A),
  };
}

const composedIdentity = Symbol('composed mounts');

/** Attach independently replaceable element lifetimes to one native `use` slot. */
export function composeMounts<T extends Element>(
  bindings: readonly (DomMount<T> | undefined)[],
): DomMount<T> {
  return { identity: composedIdentity, data: bindings, acquire: () => {} };
}

interface MountLifetime<T extends Element> {
  readonly closed: Effect.Effect<void>;
  readonly start: () => void;
  readonly close: () => Effect.Effect<void>;
  readonly update: (mount: DomMount<T>) => boolean;
  readonly dispose: (exit?: Exit.Exit<unknown, unknown>) => void;
}

function prepareComposedMount<T extends Element>(
  element: T,
  mount: DomMount<T>,
  report: ReportError,
  runtime: UiRuntime<never> | undefined,
  onClosed: (() => void) | undefined,
): MountLifetime<T> {
  let bindings = mount.data as readonly (DomMount<T> | undefined)[];
  const slots: Array<MountLifetime<T> | undefined> = [];
  const pendingClose = new Set<MountLifetime<T>>();
  const completed = Deferred.makeUnsafe<void>();
  const closed = Deferred.await(completed);
  let started = false;
  let disposed = false;
  let reconciling = false;
  let changed = false;
  let finished = false;
  const finish = () => {
    if (!finished && disposed && pendingClose.size === 0) {
      finished = true;
      Deferred.doneUnsafe(completed, Effect.void);
      onClosed?.();
    }
  };
  const release = (lifetime: MountLifetime<T> | undefined, exit?: Exit.Exit<unknown, unknown>) => {
    try {
      lifetime?.dispose(exit);
    } catch (error) {
      reportSafely(report, error);
    }
  };
  const dispose = (exit?: Exit.Exit<unknown, unknown>) => {
    if (disposed) return;
    disposed = true;
    for (let index = slots.length - 1; index >= 0; index--) release(slots[index], exit);
    slots.length = 0;
    finish();
  };
  const reconcile = () => {
    if (disposed || !started) return;
    if (reconciling) {
      changed = true;
      return;
    }
    reconciling = true;
    try {
      do {
        changed = false;
        const nextBindings = bindings;
        for (let index = 0; index < Math.max(slots.length, nextBindings.length); index++) {
          const next = nextBindings[index];
          const previous = slots[index];
          if (next && previous?.update(next)) {
            if (disposed || changed) break;
            continue;
          }
          slots[index] = undefined;
          release(previous);
          if (disposed || changed) break;
          if (next) {
            const lifetime = prepareMount(element, next, report, runtime, () => {
              pendingClose.delete(lifetime);
              finish();
            });
            slots[index] = lifetime;
            pendingClose.add(lifetime);
            lifetime.start();
            if (disposed || changed) break;
          }
        }
        if (!changed && !disposed) slots.length = nextBindings.length;
      } while (changed && !disposed);
    } catch (error) {
      dispose(Exit.die(error));
      throw error;
    } finally {
      reconciling = false;
    }
  };
  return {
    closed,
    start: () => {
      if (started || disposed) return;
      started = true;
      reconcile();
    },
    update: (next) => {
      if (disposed || next.identity !== composedIdentity) return false;
      bindings = next.data as readonly (DomMount<T> | undefined)[];
      reconcile();
      return true;
    },
    dispose,
    close: () =>
      Effect.suspend(() => {
        dispose();
        return closed;
      }),
  };
}

/** Allocate the lifetime before acquisition so reentrant publications can update or close it. */
const noCleanup = () => {};
export function prepareMount<T extends Element>(
  element: T,
  mount: DomMount<T>,
  report: ReportError = reportError,
  runtime?: UiRuntime<never>,
  onClosed?: () => void,
): MountLifetime<T> {
  if (mount.identity === composedIdentity)
    return prepareComposedMount(element, mount, report, runtime, onClosed);
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
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    Deferred.doneUnsafe(completed, Effect.void);
    onClosed?.();
  };
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
