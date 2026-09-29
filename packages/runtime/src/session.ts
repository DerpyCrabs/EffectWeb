import type * as Effect from 'effect/Effect';
import { runAll } from './errors.js';
import { modelOwner } from './owner.js';

/** Own resources and named commands in a controller with no presentation model. */
export function lifetime() {
  const owner = modelOwner({});
  return {
    add: (cleanup: () => void) => {
      owner.own({ dispose: cleanup });
    },
    own<A extends { dispose(): void; close?(): Effect.Effect<void, unknown> }>(resource: A): A {
      return owner.own(resource);
    },
    run: owner.run,
    cancel: owner.cancel,
    isRunning: owner.isRunning,
    awaitIdle: owner.awaitIdle,
    close: owner.close,
    dispose: owner.dispose,
    get disposed() {
      return owner.disposed;
    },
  };
}

/** Application selectors run once per explicit input version, with optional prior output sharing. */
export function projectionCache() {
  let version = 0;
  function select<A>(compute: (previous: A) => A, initial: A): () => A;
  function select<A>(compute: (previous: A | undefined) => A): () => A;
  function select<A>(compute: (previous: A | undefined) => A, initial?: A): () => A {
    let seen = -1,
      value = initial;
    return () => {
      if (seen !== version) {
        value = compute(value);
        seen = version;
      }
      return value!;
    };
  }
  return {
    invalidate: () => {
      version++;
    },
    select,
  };
}

interface OwnedSession {
  dispose(): void;
  refresh?(): void;
  subscribe?(changed: () => void): () => void;
}
export function sessionGroup(sessions: readonly OwnedSession[], changed: () => void) {
  const scope = lifetime();
  for (const session of sessions) scope.add(() => session.dispose());
  try {
    for (const session of sessions) {
      if (session.subscribe) scope.add(session.subscribe(changed));
    }
  } catch (error) {
    scope.dispose();
    throw error;
  }
  return {
    refresh: () => {
      if (!scope.disposed) runAll(sessions.map((session) => () => session.refresh?.()));
    },
    dispose: () => scope.dispose(),
  };
}
