import * as Effect from 'effect/Effect';
import * as Cause from 'effect/Cause';
import type * as Scope from 'effect/Scope';
import * as Stream from 'effect/Stream';
import * as SubscriptionRef from 'effect/SubscriptionRef';
import type * as Atom from 'effect/unstable/reactivity/Atom';
import * as AtomRegistry from 'effect/unstable/reactivity/AtomRegistry';
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

function publication<A>(initial: A | Snapshot<A>) {
  let current = protectSnapshot(initial) as Snapshot<A>;
  let disposed = false;
  const listeners = new Set<(value: Snapshot<A>) => void>();
  const source: Source<A> = {
    model: () => current,
    subscribe: (listener) => {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    publish(value: A | Snapshot<A>) {
      if (disposed || Object.is(current, value)) return;
      current = protectSnapshot(value) as Snapshot<A>;
      const next = current;
      // oxlint-disable-next-line unicorn/no-useless-spread -- Reentrant subscriptions must not join the publication in progress.
      for (const listener of [...listeners]) {
        if (disposed || current !== next) break;
        if (listeners.has(listener)) {
          try {
            listener(next);
          } catch (error) {
            reportSafely(reportError, error);
          }
        }
      }
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/** Observe a snapshot stream in the current Effect scope. Handle typed stream errors as values upstream. */
export const fromStream = <A, R>(
  stream: Stream.Stream<A, never, R>,
  initial: A | Snapshot<A>,
): Effect.Effect<Source<A>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const state = yield* Effect.acquireRelease(
      Effect.sync(() => publication(initial)),
      (state) => Effect.sync(() => state.dispose()),
    );
    yield* Stream.runForEach(stream, (value) => Effect.sync(() => state.publish(value))).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (!Cause.hasInterruptsOnly(cause)) reportSafely(reportError, cause);
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    );
    return state.source;
  });

/** Observe the existing ref; closing the observation leaves the ref and its other users alive. */
export const fromSubscriptionRef = <A>(
  ref: SubscriptionRef.SubscriptionRef<A>,
): Effect.Effect<Source<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const initial = yield* SubscriptionRef.get(ref);
    return yield* fromStream(SubscriptionRef.changes(ref), initial);
  });

export function fromAtom<A>(
  atom: Atom.Atom<A>,
): Effect.Effect<Source<A>, never, AtomRegistry.AtomRegistry | Scope.Scope>;
export function fromAtom<A>(
  atom: Atom.Atom<A>,
  registry: AtomRegistry.AtomRegistry,
): Effect.Effect<Source<A>, never, Scope.Scope>;
export function fromAtom<A>(atom: Atom.Atom<A>, provided?: AtomRegistry.AtomRegistry) {
  return Effect.gen(function* () {
    const registry = provided ?? (yield* AtomRegistry.AtomRegistry);
    const state = yield* Effect.acquireRelease(
      Effect.sync(() => publication(registry.get(atom))),
      (state) => Effect.sync(() => state.dispose()),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registry.subscribe(atom, (value) => state.publish(value), { immediate: true }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return state.source;
  });
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
