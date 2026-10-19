import { protectSnapshot } from './snapshot.js';
import { reportError, reportSafely } from './errors.js';

/** A current immutable value and its publications. Observation does not own the producer. */
export interface Source<A> {
  readonly model: () => A;
  readonly subscribe: (listener: (value: A) => void) => () => void;
}

interface MappedRead {
  readonly root: Source<unknown>;
  readonly parent: MappedRead | undefined;
  readonly select: (input: unknown) => unknown;
  readonly lineage: { generation: object };
  generation: object | undefined;
  initialized: boolean;
  input: unknown;
  value: unknown;
}
// Wrappers may forward a read unchanged while owning a different publication boundary.
const mappedReads = new WeakMap<Source<unknown>['model'], MappedRead>();
// An idle child must not keep an obsolete root snapshot alive just to cache its identity.
const snapshotIdentities = new WeakMap<object, symbol>();
function snapshotIdentity(value: unknown): unknown {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value;
  let identity = snapshotIdentities.get(value);
  if (identity === undefined) {
    identity = Symbol();
    snapshotIdentities.set(value, identity);
  }
  return identity;
}

// Cache actual producer snapshots, never publication order: reads remain fresh before notifications.
function readMapped(node: MappedRead): unknown {
  const input = node.root.model();
  const identity = snapshotIdentity(input);
  if (
    node.initialized &&
    node.generation === node.lineage.generation &&
    Object.is(node.input, identity)
  )
    return node.value;
  const pending: MappedRead[] = [];
  let ancestor: MappedRead | undefined = node;
  while (
    ancestor &&
    (!ancestor.initialized ||
      ancestor.generation !== ancestor.lineage.generation ||
      !Object.is(ancestor.input, identity))
  ) {
    pending.push(ancestor);
    ancestor = ancestor.parent;
  }
  let value = ancestor ? ancestor.value : input;
  for (let index = pending.length - 1; index >= 0; index--) {
    const current = pending[index]!;
    value = current.select(value);
    current.generation = current.lineage.generation;
    current.input = identity;
    current.value = value;
    current.initialized = true;
  }
  return value;
}

/** Select explicit inputs. Equal results retain their identity and do not notify subscribers. */
export function mapSource<A, B>(
  source: Source<A>,
  project: (value: A) => B,
  equals: (previous: B, next: B) => boolean = Object.is,
): Source<B> {
  let initialized = false;
  let previousInput: A;
  let current: B;
  const select = (input: A): B => {
    if (initialized && Object.is(previousInput, input)) return current;
    read.initialized = false;
    // A parent may observe other inputs before a producer reuses a snapshot, including
    // through a wrapper's independent publications. Preserve its comparator history.
    read.lineage.generation = {};
    const next = protectSnapshot(project(input)) as B;
    if (!initialized || !equals(current, next)) current = next;
    previousInput = input;
    initialized = true;
    return current;
  };
  const parent = mappedReads.get(source.model);
  const read: MappedRead = {
    root: parent?.root ?? source,
    parent,
    lineage: parent?.lineage ?? { generation: {} },
    generation: undefined,
    select: (input) => select(input as A),
    initialized: false,
    input: undefined,
    value: undefined,
  };
  const model = parent ? () => readMapped(read) as B : () => select(source.model());
  const observers = new Set<{ listener: (value: B) => void; previous: B }>();
  let stop: (() => void) | undefined;
  let connecting = false;
  let revision = 0;
  const publish = (value: A) => {
    const next = select(value);
    const version = ++revision;
    // oxlint-disable-next-line unicorn/no-useless-spread -- Reentrant subscriptions start with the next publication.
    for (const observer of [...observers]) {
      if (version !== revision) break;
      if (!observers.has(observer) || Object.is(observer.previous, next)) continue;
      observer.previous = next;
      try {
        observer.listener(next);
      } catch (error) {
        reportSafely(reportError, error);
      }
    }
  };
  const result: Source<B> = {
    model,
    subscribe(listener) {
      const observer = { listener, previous: model() };
      observers.add(observer);
      if (!stop && !connecting) {
        connecting = true;
        try {
          stop = source.subscribe(publish);
        } catch (error) {
          observers.delete(observer);
          throw error;
        } finally {
          connecting = false;
        }
        // An upstream producer may publish synchronously during subscription.
        if (observers.size === 0) {
          const release = stop;
          stop = undefined;
          release();
        }
      }
      return () => {
        if (!observers.delete(observer) || observers.size !== 0) return;
        const release = stop;
        stop = undefined;
        release?.();
      };
    },
  };
  mappedReads.set(model, read);
  return result;
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
  project: () => Model;
  reconcile?: (previous: Model, next: Model) => Model;
  afterPublish?: () => void;
}): ProjectionSource<Model> {
  const listeners = new Set<{ listener: (model: Model) => void }>();
  const subscriptions = new Set<() => void>();
  let published: Model;
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
    ) as Model;
    if (disposed || version !== revision) return;
    if (next !== published) {
      published = next;
      // oxlint-disable-next-line unicorn/no-useless-spread -- Reentrant subscriptions start with the next publication.
      for (const registration of [...listeners]) {
        if (disposed) break;
        if (listeners.has(registration)) {
          try {
            registration.listener(next);
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
      published = protectSnapshot(options.project()) as Model;
      started = true;
      if (version !== revision) changed();
    },
    model(this: void) {
      if (!started) throw new Error('Start projection publication before reading its model');
      return published;
    },
    subscribe(this: void, listener: (model: Model) => void) {
      if (disposed) return () => {};
      const registration = { listener };
      listeners.add(registration);
      return () => {
        listeners.delete(registration);
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
