import { child, compiled, viewRegion, type View } from './dom.js';
import { reportError, reportSafely, type ReportError } from './errors.js';
import { protectSnapshot, type Snapshot } from './snapshot.js';

export function errorBoundary<Model, Message>(
  content: View<Model, Message>,
  options: {
    readonly fallback: View<
      { readonly model: NoInfer<Model>; readonly error: unknown },
      NoInfer<Message>
    >;
    readonly reset?: (model: Snapshot<NoInfer<Model>>) => unknown;
    readonly onError?: ReportError;
  },
): View<Model, Message> {
  return compiled((scope, parent, before) => {
    let failed = false;
    let error: unknown;
    let generation = 0;
    let reset = options.reset?.(scope.value as Snapshot<Model>);
    const fallback = compiled<Model, Message>((scope, parent, before) => {
      child(
        scope,
        parent,
        before,
        options.fallback,
        () => [scope.value],
        () => protectSnapshot({ model: scope.value, error }),
        scope.send,
      );
    });
    const region = { manual: true, report: scope.report };
    const render = viewRegion(scope, parent, before, region);
    function showFallback() {
      if (scope.disposed || !failed) return;
      region.report = scope.report;
      try {
        render(fallback);
      } catch (error) {
        reportSafely(scope.report, error);
      }
    }
    function fail(cause: unknown, attempt: number) {
      if (scope.disposed || attempt !== generation) {
        reportSafely(options.onError ?? reportError, cause);
        return;
      }
      failed = true;
      error = cause;
      const token = ++generation;
      render(undefined);
      reportSafely(options.onError ?? reportError, cause);
      queueMicrotask(() => {
        if (token === generation) showFallback();
      });
    }
    const update = () => {
      const next = options.reset?.(scope.value as Snapshot<Model>);
      if (!Object.is(reset, next)) {
        reset = next;
        generation++;
        render(undefined);
        failed = false;
        error = undefined;
      }
      if (failed) showFallback();
      else {
        const attempt = generation;
        region.report = (cause) => fail(cause, attempt);
        try {
          render(content);
        } catch (error) {
          fail(error, attempt);
        }
      }
    };
    scope.jobs.push(update);
    update();
  });
}
