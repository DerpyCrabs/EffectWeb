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
