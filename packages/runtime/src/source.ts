import { protectSnapshot, type Snapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';

/** A current immutable value and its publications. Observation does not own the producer. */
export interface Source<A> {
  readonly model: () => Snapshot<A>;
  readonly subscribe: (listener: (value: Snapshot<A>) => void) => () => void;
}

/** Select explicit inputs. Equal results retain their identity and do not notify subscribers. */
export function mapSource<A, B>(
  source: Source<A>,
  project: (value: Snapshot<A>) => B | Snapshot<B>,
  equals: (previous: Snapshot<B>, next: Snapshot<B>) => boolean = Object.is,
): Source<B> {
  let initialized = false;
  let previousInput: Snapshot<A>;
  let current: Snapshot<B>;
  const select = (input: Snapshot<A>): Snapshot<B> => {
    if (initialized && Object.is(previousInput, input)) return current;
    const next = protectSnapshot(project(input)) as Snapshot<B>;
    if (!initialized || !equals(current, next)) current = next;
    previousInput = input;
    initialized = true;
    return current;
  };
  const model = () => select(source.model());
  return {
    model,
    subscribe(listener) {
      let previous = model();
      return source.subscribe((value) => {
        const next = select(value);
        if (Object.is(previous, next)) return;
        previous = next;
        listener(next);
      });
    },
  };
}

/** A batched publication boundary for independently owned sessions with explicit invalidation. */
export function projectionSource<Model>(options: {
  invalidate?: () => void;
  refresh?: () => void;
  project: () => Model | Snapshot<Model>;
  reconcile?: (previous: Snapshot<Model>, next: Model | Snapshot<Model>) => Model | Snapshot<Model>;
  afterPublish?: () => void;
}) {
  const listeners = new Set<(model: Snapshot<Model>) => void>();
  const subscriptions = new Set<() => void>();
  let published: Snapshot<Model>;
  let started = false;
  let disposed = false;
  let queued = false;
  let revision = 0;
  const changed = () => {
    if (disposed) return;
    revision++;
    options.invalidate?.();
    if (!started || queued) return;
    queued = true;
    queueMicrotask(flush);
  };
  function flush() {
    queued = false;
    if (disposed) return;
    options.refresh?.();
    if (disposed) return;
    const version = revision;
    const value = options.project();
    const next = protectSnapshot(
      options.reconcile ? options.reconcile(published, value) : value,
    ) as Snapshot<Model>;
    if (disposed || version !== revision) return;
    if (next !== published) {
      published = next;
      // oxlint-disable-next-line unicorn/no-useless-spread -- Reentrant subscriptions start with the next publication.
      for (const listener of [...listeners]) {
        if (disposed) break;
        if (listeners.has(listener)) {
          try {
            listener(next);
          } catch (error) {
            reportSafely(reportError, error);
          }
        }
      }
    }
    if (!disposed) options.afterPublish?.();
  }
  return {
    get disposed() {
      return disposed;
    },
    changed,
    watch(source: { subscribe: (changed: () => void) => () => void }) {
      if (disposed) return () => {};
      const unsubscribe = source.subscribe(changed);
      let active = true;
      const stop = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(stop);
        unsubscribe();
      };
      if (disposed) stop();
      else subscriptions.add(stop);
      return stop;
    },
    start() {
      if (disposed || started) return;
      options.refresh?.();
      if (disposed) return;
      const version = revision;
      published = protectSnapshot(options.project()) as Snapshot<Model>;
      started = true;
      if (version !== revision) changed();
    },
    model(this: void) {
      if (!started) throw new Error('Start projection publication before reading its model');
      return published;
    },
    subscribe(this: void, listener: (model: Snapshot<Model>) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      const errors: unknown[] = [];
      for (const stop of [...subscriptions].reverse()) {
        try {
          stop();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, 'Projection subscription cleanup failed');
    },
  };
}

/**
 * The current time in epoch milliseconds, published every `interval` while observed.
 * Declare it once at module scope and read it with `observe(minute, (now) => …)` or
 * `mapSource`: views never read the clock themselves. It keeps no timer while unobserved.
 */
export function clock(interval: number): Source<number> {
  if (!(interval > 0)) throw new RangeError('clock interval must be a positive number of ms');
  const listeners = new Set<(value: number) => void>();
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    model: () => (listeners.size ? now : (now = Date.now())),
    subscribe(listener) {
      if (!listeners.size) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          for (const notify of listeners) notify(now);
        }, interval);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) clearInterval(timer);
      };
    },
  };
}
