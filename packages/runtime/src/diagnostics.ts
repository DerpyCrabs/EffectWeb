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
  readonly reason: 'initial' | 'dependencies';
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
    reason: previous ? 'dependencies' : 'initial',
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

/** Counts aggregate all mounted instances of a source expression. */
export interface BindingInspection {
  readonly source: BindingSource;
  readonly derives: number;
  readonly bindings: number;
  readonly changed: readonly string[];
  readonly reason: BindingUpdate['reason'];
}
export interface BindingInspector {
  /** Most recently updated first; bounded by limit (default 200, maximum 1000). */
  entries(): readonly BindingInspection[];
  subscribe(next: () => void): () => void;
  clear(): void;
  /** Unsubscribe and release all metadata and listeners. */
  dispose(): void;
}
/** Development metadata only: never reads or retains models, values, or DOM nodes. */
export function inspectBindings(options: { readonly limit?: number } = {}): BindingInspector {
  const requested = options.limit ?? 200;
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(1000, Math.floor(requested)))
    : 200;
  const records = new Map<string, BindingInspection>();
  const listeners = new Set<() => void>();
  let disposed = false;
  const notify = () => {
    // New subscribers start with the next event.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch (error) {
        reportSafely(reportError, error);
      }
    }
  };
  const stop = observeBindings((update) => {
    const source = update.source;
    const key = JSON.stringify([source.file, source.line, source.column, source.expression]);
    const previous = records.get(key);
    const record: BindingInspection = Object.freeze({
      source: Object.freeze({
        file: source.file,
        line: source.line,
        column: source.column,
        expression: source.expression,
        dependencies: Object.freeze([...source.dependencies]),
      }),
      derives: (previous?.derives ?? 0) + Number(update.kind === 'derive'),
      bindings: (previous?.bindings ?? 0) + Number(update.kind === 'binding'),
      changed: Object.freeze([...update.changed]),
      reason: update.reason,
    });
    records.delete(key);
    records.set(key, record);
    if (records.size > limit) records.delete(records.keys().next().value!);
    notify();
  });
  return {
    entries: () => [...records.values()].reverse(),
    subscribe(next) {
      if (!disposed) listeners.add(next);
      return () => {
        listeners.delete(next);
      };
    },
    clear() {
      records.clear();
      if (!disposed) notify();
    },
    dispose() {
      disposed = true;
      stop();
      records.clear();
      listeners.clear();
    },
  };
}

/** Mount a live source inspector. Mount before the application to include initial evaluations.
 * The returned cleanup removes the panel; an externally supplied inspector keeps its lifetime.
 */
export function mountBindingInspector(
  target: HTMLElement,
  inspector?: BindingInspector,
): () => void {
  const inspection = inspector ?? inspectBindings();
  const document = target.ownerDocument;
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'EffectWeb dependency inspector');
  const heading = document.createElement('h2');
  heading.textContent = 'EffectWeb dependencies';
  const hint = document.createElement('p');
  hint.textContent =
    'Development builds only. Counts include initial evaluations and aggregate mounted instances. Old sources are evicted.';
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = 'Filter file, expression or dependency';
  filter.setAttribute('aria-label', filter.placeholder);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear counts';
  const table = document.createElement('table');
  const header = table.createTHead().insertRow();
  for (const label of [
    'Source expression',
    'Inferred dependencies',
    'Latest reason',
    'Derives',
    'Bindings',
  ]) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  const status = document.createElement('p');
  let active = true;
  let queued = false;
  const render = () => {
    queued = false;
    if (!active) return;
    const search = filter.value.toLowerCase();
    const entries = inspection
      .entries()
      .filter((entry) =>
        [entry.source.file, entry.source.expression, ...entry.source.dependencies]
          .join(' ')
          .toLowerCase()
          .includes(search),
      );
    body.replaceChildren();
    for (const entry of entries) {
      const row = body.insertRow();
      const source = entry.source;
      const values = [
        `${source.file}:${source.line}:${source.column}\n${source.expression}`,
        source.dependencies.join(', ') || 'No snapshot dependencies',
        entry.reason === 'initial'
          ? 'Initial evaluation'
          : `Changed: ${entry.changed.join(', ') || 'dependency value'}`,
        String(entry.derives),
        String(entry.bindings),
      ];
      for (const value of values) {
        const cell = row.insertCell();
        cell.textContent = value;
        cell.style.whiteSpace = 'pre-wrap';
        cell.style.verticalAlign = 'top';
        cell.style.padding = '0.4em';
      }
    }
    status.textContent = entries.length
      ? `${entries.length} source expressions`
      : 'No matching evaluations. Interact with an application compiled in development mode.';
  };
  const schedule = () => {
    if (!queued && active) {
      queued = true;
      queueMicrotask(render);
    }
  };
  const reset = () => inspection.clear();
  filter.addEventListener('input', render);
  clear.addEventListener('click', reset);
  const stop = inspection.subscribe(schedule);
  panel.append(heading, hint, filter, clear, table, status);
  target.append(panel);
  render();
  return () => {
    active = false;
    stop();
    filter.removeEventListener('input', render);
    clear.removeEventListener('click', reset);
    panel.remove();
    if (!inspector) inspection.dispose();
  };
}
