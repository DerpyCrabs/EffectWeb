import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Exit from 'effect/Exit';
import { commandSlot, program, type Command, type TaskPolicy } from './program.js';
import type { DisposableOwner } from './owner.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';
import { reportError, reportSafely } from './errors.js';
import { protectSnapshot, type Snapshot } from './snapshot.js';

export type TaskOutcome<A, E> =
  | { readonly _tag: 'Success'; readonly value: Snapshot<A> }
  | { readonly _tag: 'Failure'; readonly cause: Cause.Cause<E> }
  | { readonly _tag: 'Cancelled' | 'Superseded' | 'Dropped' };
export interface TaskHandle<A, E> {
  readonly outcome: Effect.Effect<TaskOutcome<A, E>>;
}
/** Per-entity serialization. Inputs are captured now; run reads services when work starts. */
export function keyedTasks<Key, Input, A, E = never, R = never>(
  owner: DisposableOwner,
  definition: {
    readonly name: string;
    readonly policy: TaskPolicy;
    readonly run: (key: Key, input: Snapshot<Input>) => Effect.Effect<A, E, R | Scope.Scope>;
  },
  ...provided: [Exclude<R, Scope.Scope>] extends [never]
    ? [runtime?: UiRuntime<R>]
    : [runtime: UiRuntime<R>]
) {
  const runtime = provided[0] ?? (defaultUiRuntime as UiRuntime<R>);
  type Entry = { source: ReturnType<typeof makeSource>; version: number; retiring: boolean };
  const entries = new Map<Key, Entry>();
  let disposed = false;
  type Message = { command: Command<Message> } | { cancel: true };
  const slot = commandSlot(definition.name);
  const makeSource = () =>
    program<null, Message>({
      initial: null,
      update: (model, message) =>
        'command' in message ? { model, commands: [message.command] } : { model, cancel: [slot] },
    });
  // Each key owns a program, including its interrupted fibers, so drain never waits on other keys.
  const get = (key: Key) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = { source: makeSource(), version: 0, retiring: false };
      entries.set(key, entry);
    }
    return entry;
  };
  const dispose = () => {
    disposed = true;
    for (const entry of entries.values()) entry.source.dispose();
  };
  const close = () =>
    Effect.gen(function* () {
      dispose();
      yield* Effect.all(
        [...entries.values()].map((entry) => entry.source.close()),
        { concurrency: 'unbounded' },
      );
      entries.clear();
    });
  owner.own({ dispose, close });
  return {
    submit(key: Key, input: Input | Snapshot<Input>): TaskHandle<A, E> {
      if (disposed || owner.disposed)
        return { outcome: Effect.succeed(Object.freeze({ _tag: 'Cancelled' as const })) };
      const captured = protectSnapshot(input) as Snapshot<Input>;
      const entry = get(key);
      entry.version++;
      const result = Deferred.makeUnsafe<TaskOutcome<A, E>>();
      const outcome = Deferred.await(result);
      const settle = (value: TaskOutcome<A, E>) => {
        Deferred.doneUnsafe(result, Effect.succeed(protectSnapshot(value)));
      };
      Effect.runFork(
        Effect.gen(function* () {
          yield* outcome;
          if (entry.retiring) return;
          entry.retiring = true;
          let version: number;
          do {
            version = entry.version;
            yield* entry.source.awaitStopped();
          } while (version !== entry.version);
          if (entries.get(key) === entry) {
            entries.delete(key);
            entry.source.dispose();
          }
        }),
      ).addObserver((exit) => {
        if (Exit.isFailure(exit)) reportSafely(reportError, exit.cause);
      });
      const action = Effect.uninterruptibleMask((restore) =>
        restore(
          Effect.scoped(
            Effect.suspend(() => definition.run(key, captured)).pipe(
              Effect.map((value) => protectSnapshot(value) as Snapshot<A>),
            ),
          ),
        ).pipe(
          Effect.exit,
          Effect.flatMap((exit) =>
            Effect.sync(() =>
              settle(
                Exit.isSuccess(exit)
                  ? { _tag: 'Success', value: exit.value }
                  : Cause.hasInterruptsOnly(exit.cause)
                    ? { _tag: 'Cancelled' }
                    : { _tag: 'Failure', cause: exit.cause },
              ),
            ),
          ),
        ),
      );
      entry.source.send({
        command: {
          slot,
          policy: definition.policy,
          action: runtime.provideScoped(action),
          onDiscard: (_tag) => settle({ _tag }),
        },
      });
      return { outcome };
    },
    cancel(key: Key) {
      const entry = entries.get(key);
      if (entry) {
        entry.version++;
        entry.source.send({ cancel: true });
      }
    },
    drain(...selected: [] | [Key]): Effect.Effect<void> {
      return Effect.suspend(() => {
        const pending = selected.length
          ? [entries.get(selected[0])].filter((entry): entry is Entry => !!entry)
          : [...entries.values()];
        return Effect.all(
          pending.map((entry) =>
            Effect.andThen(entry.source.awaitIdle(), entry.source.awaitStopped()),
          ),
          { concurrency: 'unbounded', discard: true },
        );
      });
    },
    close,
    dispose,
  };
}
