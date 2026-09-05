import { reportError, reportSafely, type ReportError } from './errors.js';
import { Effect, Fiber } from 'effect';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';
import type { JSX } from './jsx.js';
type Work<R = never> =
  | (() => void)
  | { dispose: () => void; update?: () => void }
  | Effect.Effect<never, unknown, R>;
export function Portal(_props: { children?: JSX.Element }): JSX.Element {
  throw new Error('Portal must be compiled inside a view');
}
export interface DomMount {
  readonly identity: unknown;
  readonly data: unknown;
  readonly acquire: (element: Element, input: () => unknown) => Work;
}
/** Element-owned work. Changed acquisition functions replace and interrupt the prior lifetime. */
export function domMount<T extends Element, R = never>(
  start: (element: T) => Work<R>,
  ...provided: [R] extends [never] ? [runtime?: UiRuntime<R>] : [runtime: UiRuntime<R>]
): DomMount {
  const runtime = provided[0] ?? (defaultUiRuntime as UiRuntime<R>);
  return {
    identity: start,
    data: undefined,
    acquire: (element) => {
      const work = start(element as T);
      return Effect.isEffect(work) ? runtime.provide(work) : work;
    },
  };
}
/** A stable DOM lifecycle with fresh immutable inputs, for focus, measurements and native events. */
export function domBinding<T extends Element, A, R = never>(
  data: A,
  acquire: (element: T, input: () => A) => Work<R>,
  ...provided: [R] extends [never] ? [runtime?: UiRuntime<R>] : [runtime: UiRuntime<R>]
): DomMount {
  return {
    identity: acquire,
    data,
    acquire: (element, input) => {
      const work = acquire(element as T, input as () => A);
      const runtime = provided[0] ?? (defaultUiRuntime as UiRuntime<R>);
      return Effect.isEffect(work) ? runtime.provide(work) : work;
    },
  };
}
export function startMount(element: Element, mount: DomMount, report: ReportError = reportError) {
  let data = mount.data;
  const work = mount.acquire(element, () => data);
  const fiber = Effect.isEffect(work) ? Effect.runFork(work) : undefined;
  let disposed = false;
  fiber?.addObserver((exit) => {
    if (exit._tag === 'Failure' && !disposed) reportSafely(report, exit.cause);
  });
  return {
    update(next: DomMount) {
      if (next.identity !== mount.identity) return false;
      data = next.data;
      if (!fiber && typeof work === 'object' && 'update' in work) work.update?.();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (fiber) Effect.runFork(Fiber.interrupt(fiber));
      else if (typeof work === 'function') work();
      else if ('dispose' in work) work.dispose();
    },
  };
}
