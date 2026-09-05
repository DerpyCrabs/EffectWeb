export type ReportError = (error: unknown) => void;
export const reportError: ReportError = (error) => console.error(error);

/** Reporters are observers. A broken reporter must not prevent cleanup or sibling updates. */
export function reportSafely(report: ReportError, error: unknown) {
  try {
    report(error);
  } catch (reporterError) {
    console.error(reporterError);
  }
}
export function runAll(work: readonly (() => void)[], report: ReportError = reportError) {
  const errors: unknown[] = [];
  for (const run of work) {
    try {
      run();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) reportSafely(report, new AggregateError(errors, 'UI work failed'));
}
