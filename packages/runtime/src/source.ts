import { protectSnapshot, type Snapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';
import { encodeKey } from './command-key.js';
import type { RunKey } from './program.js';

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

/** A projection's published model, its inputs and its lifetime. */
export interface ProjectionSource<Model> extends Source<Model> {
  readonly disposed: boolean;
  /** Mark the projection stale; it publishes once in the next microtask. */
  readonly changed: () => void;
  /** Follow an input: every notification marks the projection stale. Returns the unsubscribe. */
  readonly watch: (source: { subscribe: (changed: () => void) => () => void }) => () => void;
  /** Compute the first model. `model()` throws before this. */
  readonly start: () => void;
  readonly dispose: () => void;
}
/** A batched publication boundary for independently owned sessions with explicit invalidation. */
export function projectionSource<Model>(options: {
  invalidate?: () => void;
  refresh?: () => void;
  project: () => Model | Snapshot<Model>;
  reconcile?: (previous: Snapshot<Model>, next: Model | Snapshot<Model>) => Model | Snapshot<Model>;
  afterPublish?: () => void;
}): ProjectionSource<Model> {
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

/**
 * A live value per key, such as who is viewing a card or a stock price, from a subscription
 * API. `subscribe(key, publish)` starts when something first observes the key and the function
 * it returns stops it when the last observer leaves, so `observe(viewers(card.id), render)`
 * watches a card exactly while that part of the page is shown. Equal keys share one
 * subscription. Until the first publication, and after it stops, the value is `initial(key)`.
 */
export function liveSource<Key extends RunKey, A>(options: {
  readonly initial: (key: Key) => A;
  readonly subscribe: (key: Key, publish: (value: A) => void) => () => void;
}): (key: Key) => Source<A> {
  type Entry = {
    value: Snapshot<A>;
    listeners: Set<(value: Snapshot<A>) => void>;
    stop?: (() => void) | undefined;
    starting: boolean;
  };
  const entries = new Map<string, { entry: Entry; source: Source<A> }>();
  const create = (key: Key, id: string) => {
    const entry: Entry = {
      value: protectSnapshot(options.initial(key)) as Snapshot<A>,
      listeners: new Set(),
      starting: false,
    };
    const source: Source<A> = {
      // A retained handle follows the current entry after the idle entry was evicted.
      model: () => {
        const current = entries.get(id);
        return current ? current.entry.value : entry.value;
      },
      subscribe(listener) {
        const current = entries.get(id);
        if (current && current.entry !== entry) return current.source.subscribe(listener);
        // Each subscription owns its own listener, even when callbacks are shared.
        const notify = (value: Snapshot<A>) => listener(value);
        entry.listeners.add(notify);
        if (!entry.stop && !entry.starting) {
          if (!entries.has(id)) entries.set(id, { entry, source });
          let active = true;
          entry.starting = true;
          try {
            const stop = options.subscribe(key, (value) => {
              if (!active) return;
              const next = protectSnapshot(value) as Snapshot<A>;
              if (Object.is(next, entry.value)) return;
              entry.value = next;
              for (const notify of Array.from(entry.listeners)) notify(next);
            });
            entry.stop = () => {
              active = false;
              stop();
            };
          } catch (error) {
            active = false;
            entry.listeners.delete(notify);
            if (!entry.listeners.size) release();
            throw error;
          } finally {
            entry.starting = false;
          }
          // A publication during setup may have ended the observation already.
          if (!entry.listeners.size) release();
        }
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          entry.listeners.delete(notify);
          if (!entry.listeners.size) release();
        };
      },
    };
    const release = () => {
      const stop = entry.stop;
      entry.stop = undefined;
      if (entries.get(id)?.entry === entry) entries.delete(id);
      entry.value = protectSnapshot(options.initial(key)) as Snapshot<A>;
      stop?.();
    };
    return { entry, source };
  };
  return (key) => {
    const id = encodeKey(key);
    let found = entries.get(id);
    if (!found) {
      found = create(key, id);
      entries.set(id, found);
    }
    return found.source;
  };
}
