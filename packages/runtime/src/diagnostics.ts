import { reportError, reportSafely } from './errors.js';
/** Emitted only by development builds. No model values are retained in diagnostic events. */
export interface BindingSource {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly expression: string;
  readonly dependencies: readonly string[];
}
export interface BindingUpdate {
  readonly source: BindingSource;
  readonly changed: readonly string[];
  readonly kind: 'derive' | 'binding';
}
const observers = new Map<symbol, (update: BindingUpdate) => void>();
/** Each registration has its own lifetime; observers can be stopped in any order. */
export function observeBindings(next: (update: BindingUpdate) => void) {
  const token = Symbol();
  observers.set(token, next);
  return () => {
    observers.delete(token);
  };
}
export function traceBinding(
  source: BindingSource | undefined,
  previous: readonly unknown[] | undefined,
  next: readonly unknown[],
  kind: BindingUpdate['kind'],
) {
  if (!source || !observers.size) return;
  const update: BindingUpdate = {
    source,
    kind,
    changed: source.dependencies.filter(
      (_, index) => !previous || !Object.is(previous[index], next[index]),
    ),
  };
  // Observers registered during dispatch start with the next update.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const [token, observer] of [...observers]) {
    if (!observers.has(token)) continue;
    try {
      observer(update);
    } catch (error) {
      reportSafely(reportError, error);
    }
  }
}

export interface ProgramUpdate {
  readonly program: number;
  readonly name?: string;
  readonly kind: 'update' | 'start' | 'cancel' | 'complete' | 'defect' | 'dispose';
  readonly slot?: string;
  /** Message discriminant only. Payloads, model values and resource keys are never retained. */
  readonly message?: string;
}
let programId = 0;
export const nextProgramId = () => ++programId;
const programObservers = new Set<(event: ProgramUpdate) => void>();
export const hasProgramObservers = () => programObservers.size > 0;
export function traceProgram(event: ProgramUpdate) {
  for (const observer of programObservers) {
    try {
      observer(event);
    } catch (error) {
      reportSafely(reportError, error);
    }
  }
}
/** Opt-in bounded metadata history. Inspection only: no command replay or payload snapshots. */
export function observePrograms(limit = 100) {
  const capacity = Math.max(1, Math.min(1000, Math.floor(limit) || 100));
  const entries: ProgramUpdate[] = [];
  const receive = (event: ProgramUpdate) => {
    entries.push(event);
    if (entries.length > capacity) entries.shift();
  };
  programObservers.add(receive);
  return { events: () => entries.slice(), dispose: () => programObservers.delete(receive) };
}
