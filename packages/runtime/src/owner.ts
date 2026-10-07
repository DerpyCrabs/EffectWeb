import { equalKeys, copyKey, KeyMap } from './command-key.js';
import { protectSnapshot, type Snapshot } from './snapshot.js';
import * as Cause from 'effect/Cause';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import type * as Scope from 'effect/Scope';
import {
  createProgram,
  type OwnedCommand,
  type Program,
  type RunPolicy,
  type RunKey,
} from './program.js';
import { patchModel } from './state.js';
import { runAll, reportError, reportSafely, type ReportError } from './errors.js';
import type { UiRuntime } from './runtime.js';
import type * as Context from 'effect/Context';

export type { RunPolicy } from './program.js';
interface OwnedResource {
  dispose(): void;
  close?(): Effect.Effect<void, unknown>;
}
/** A disposable resource, or a plain cleanup such as an unsubscribe function. */
export type Ownable = OwnedResource | (() => void);
/**
 * Work an owner has started. Unlike an Effect it is already running; `await` only observes it,
 * so ignoring the handle is safe and interrupting an observer does not cancel the work.
 */
export interface OwnedRun<A, E> {
  readonly await: Effect.Effect<Exit.Exit<A, E>>;
}
export interface DisposableOwner {
  readonly disposed: boolean;
  /** Tie a resource or cleanup function to this owner; it runs on `dispose`/`close`. */
  readonly own: <A extends Ownable>(resource: A) => A;
}
export interface ModelOwner<Model extends object, R = never> extends DisposableOwner {
  readonly source: Program<Model, never>;
  /** Latest accepted immutable state, including writes queued during command startup. */
  readonly read: () => Snapshot<Model>;
  readonly patch: (changes: Partial<Model> | Partial<Snapshot<Model>>) => void;
  readonly edit: <K extends keyof Model>(
    key: K,
    change: (value: Snapshot<Model[K]>) => Model[K] | Snapshot<Model[K]>,
  ) => void;
  /**
   * Starts the work now and returns a handle to this run. `yield* run.await` gives its `Exit`
   * once the work and its finalizers are done, as `Fiber.await` does: a cancelled, replaced,
   * dropped or disposed run is an interruption.
   */
  readonly run: <A, E>(
    key: RunKey,
    effect: Effect.Effect<A, E, R | Scope.Scope>,
    policy: RunPolicy,
  ) => OwnedRun<A, E>;
  /**
   * `run`, publishing the work's `AsyncResult` in the model: `task('saved', save, 'drop')`
   * writes `model.saved`, and `task(['saving', id], save, 'drop')` writes `model.saving[id]`.
   * The key is both the command key and the place the result is written. The result is
   * waiting while work for the key is running or queued, keeps its previous value, and is
   * never overwritten by a run that was replaced.
   */
  readonly task: <Key extends TaskKey<Model>>(
    key: Key,
    effect: TaskEffect<Model, Key, R>,
    policy: Exclude<RunPolicy, 'parallel'>,
  ) => OwnedRun<TaskValue<Model, Key>, TaskError<Model, Key>>;
  /** Interrupt the key's running work and discard its pending work. */
  readonly cancel: (key: RunKey) => void;
  /** Resolves when the key (or every key) has no running or pending work. */
  readonly awaitIdle: (key?: RunKey) => Effect.Effect<void>;
  /**
   * Interrupt and join work before closing owned dependencies in reverse order. Cleanup failures
   * are reported to `onDefect`, so `Effect.acquireRelease(…, (owner) => owner.close())` needs no `orDie`.
   */
  readonly close: () => Effect.Effect<void>;
  readonly dispose: () => void;
}

type AnyResult = AsyncResult.AsyncResult<unknown, unknown>;
/** Model fields holding one `AsyncResult`. */
type ResultField<Model> = {
  [K in keyof Model]-?: Model[K] extends AnyResult ? K : never;
}[keyof Model] &
  (string | number);
/** Model fields holding a record of `AsyncResult`s, one per row. */
type RowResultField<Model> = {
  [K in keyof Model]-?: Model[K] extends { readonly [id: string]: AnyResult | undefined }
    ? Model[K] extends AnyResult
      ? never
      : K
    : never;
}[keyof Model] &
  (string | number);
/** `'field'` for a field holding an `AsyncResult`, `['field', id]` for a record of them. */
export type TaskKey<Model> = ResultField<Model> | readonly [RowResultField<Model>, string | number];
type TaskResult<Model, Key> = Key extends readonly [infer Field extends keyof Model, unknown]
  ? Exclude<Model[Field][keyof Model[Field]], undefined>
  : Key extends keyof Model
    ? Model[Key]
    : never;
export type TaskValue<Model, Key> =
  TaskResult<Model, Key> extends AsyncResult.AsyncResult<infer A, infer _E> ? A : never;
export type TaskError<Model, Key> =
  TaskResult<Model, Key> extends AsyncResult.AsyncResult<infer _A, infer E> ? E : never;
/**
 * The Effect a task accepts. When the field cannot hold the outcome, the parameter names the
 * fix instead: `AsyncResult.initial()` alone has the narrower type `Initial`, and a row record
 * must allow rows that have not run yet.
 */
type TaskEffect<Model, Key, R> = Key extends readonly [infer Field extends keyof Model, unknown]
  ? undefined extends Model[Field][keyof Model[Field]]
    ? Effect.Effect<TaskValue<Model, Key>, TaskError<Model, Key>, R | Scope.Scope>
    : 'Declare per-row results as Partial<Record<Id, AsyncResult.AsyncResult<Value, Error>>>'
  : AsyncResult.AsyncResult<TaskValue<Model, Key>, TaskError<Model, Key>> extends TaskResult<
        Model,
        Key
      >
    ? Effect.Effect<TaskValue<Model, Key>, TaskError<Model, Key>, R | Scope.Scope>
    : 'Declare the result field as AsyncResult.AsyncResult<Value, Error>; AsyncResult.initial() alone has the narrower type Initial';

type Options = { onDefect?: ReportError };
/**
 * A feature store with owned work. `context` supplies the services its runs require. Inside an
 * Effect, scope it with `Effect.acquireRelease(Effect.sync(() => modelOwner(…)), (o) => o.close())`.
 */
export function modelOwner<Model extends object>(
  initial: Model,
  options?: Options,
): ModelOwner<Model>;
export function modelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { context: Context.Context<R> },
): ModelOwner<Model, R>;
export function modelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { context?: Context.Context<R> } = {},
): ModelOwner<Model, R> {
  const { context, ...rest } = options;
  return createModelOwner<Model, R>(
    initial,
    context ? { ...rest, runtime: contextRunner(context) } : rest,
  );
}

/** What an owner needs to run its work: owner commands are always `action`s. */
type OwnerRuntime<R> = Pick<UiRuntime<R>, 'runFork' | 'command'>;
/**
 * Run an owner's work with a fixed context. Lighter than `uiRuntime`, which also provides
 * stream commands, so an owner given a `context` does not pull the Stream module in.
 */
function contextRunner<R>(context: Context.Context<R>): OwnerRuntime<R> {
  const run = Effect.runForkWith(context);
  return {
    runFork: (effect) => run(Effect.scoped(effect)),
    command: (command) =>
      ({
        ...command,
        action: Effect.provideContext(
          Effect.scoped((command as { action: Effect.Effect<void, unknown, R> }).action),
          context,
        ),
      }) as OwnedCommand<never>,
  };
}

/** `modelOwner` running its work through a mount's or component's runtime. Internal. */
export function createModelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { runtime?: OwnerRuntime<R> } = {},
): ModelOwner<Model, R> {
  type Operation =
    | { type: 'Patch'; changes: Partial<Model> | Partial<Snapshot<Model>> }
    | {
        type: 'Run';
        key: RunKey;
        effect: Effect.Effect<unknown, unknown, R | Scope.Scope>;
        policy: RunPolicy;
        onSettled: NonNullable<OwnedCommand<Batch>['onSettled']>;
        onDiscard: NonNullable<OwnedCommand<Batch>['onDiscard']>;
        published: boolean;
      }
    | { type: 'Cancel'; key: RunKey };
  type Batch = readonly Operation[];
  let disposed = false;
  const notStarted = new Set<() => void>();
  const discardUnstarted = () => {
    for (const discard of notStarted) discard();
  };
  const cleanups: OwnedResource[] = [];
  let resourcesDisposed = false;
  const source = createProgram<Model, Batch>({
    initial,
    ...(options.onDefect ? { onDefect: options.onDefect } : {}),
    ...(options.runtime
      ? {
          runtime: {
            runFork: <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
              options.runtime!.runFork(effect),
          },
        }
      : {}),
    update(snapshot, operations) {
      let model = snapshot as Model;
      const single = operations.length === 1 ? operations[0] : undefined;
      if (single?.type === 'Patch')
        return { model: patchModel(model, single.changes as Partial<Model>) };
      const commands: OwnedCommand<Batch, R>[] = [];
      const cancel = new Set<RunKey>();
      for (const operation of operations) {
        if (operation.type === 'Patch')
          model = patchModel(model, operation.changes as Partial<Model>);
        else if (operation.type === 'Cancel') {
          cancel.add(operation.key);
          for (let index = commands.length - 1; index >= 0; index--)
            if (equalKeys(commands[index]!.key, operation.key)) {
              commands[index]!.onDiscard?.('Cancelled');
              commands.splice(index, 1);
            }
        } else {
          const { key, effect, policy, onSettled, onDiscard, published } = operation;
          commands.push({
            key,
            policy,
            action: Effect.asVoid(effect),
            onSettled,
            onDiscard,
            ...(published ? { reportsDefectsOnly: true } : {}),
          });
        }
      }
      return {
        model,
        cancel: [...cancel],
        commands: commands.map((command) =>
          options.runtime ? options.runtime.command(command) : (command as OwnedCommand<Batch>),
        ),
      };
    },
  });
  let accepted = source.model() as Model;
  const read = (): Snapshot<Model> => protectSnapshot(accepted) as Snapshot<Model>;
  const submit = (operation: Operation) => {
    if (disposed) {
      if (operation.type === 'Run') operation.onDiscard('Disposed');
      return;
    }
    submitBatch([operation]);
  };
  const patch = (changes: Partial<Model> | Partial<Snapshot<Model>>) =>
    submit({ type: 'Patch', changes });
  const submitBatch = (operations: Batch) => {
    let next = accepted;
    for (const operation of operations)
      if (operation.type === 'Patch') next = patchModel(next, operation.changes as Partial<Model>);
    // Commands and publication callbacks can enqueue patches while the program is draining.
    // Reads observe accepted writes immediately; views still receive committed publications.
    accepted = protectSnapshot(next) as Model;
    source.send(operations);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    discardUnstarted();
    source.dispose();
    resourcesDisposed = true;
    runAll(
      [...cleanups].reverse().map((resource) => () => resource.dispose()),
      options.onDefect ?? reportError,
    );
  };
  // Built on first use: most owners are disposed synchronously and never need it.
  let closing: Effect.Effect<void> | undefined;
  const close = () =>
    (closing ??= Effect.runSync(
      Effect.cached(
        Effect.uninterruptible(
          Effect.gen(function* () {
            disposed = true;
            discardUnstarted();
            const resources = cleanups.splice(0).reverse();
            yield* source.close();
            const errors: unknown[] = [];
            for (const resource of resources) {
              const exit = yield* Effect.exit(
                Effect.suspend(() =>
                  resource.close
                    ? resource.close()
                    : resourcesDisposed
                      ? Effect.void
                      : Effect.sync(() => resource.dispose()),
                ),
              );
              if (Exit.isFailure(exit)) errors.push(Cause.squash(exit.cause));
            }
            if (errors.length)
              reportSafely(
                options.onDefect ?? reportError,
                new AggregateError(errors, 'Owner cleanup failed.'),
              );
          }),
        ),
      ),
    ));
  const run = <A, E>(
    key: RunKey,
    effect: Effect.Effect<A, E, R | Scope.Scope>,
    policy: RunPolicy,
    onNotStarted?: () => void,
    published = false,
  ): OwnedRun<A, E> => {
    const completed = Deferred.makeUnsafe<Exit.Exit<A, E>>();
    let value!: A;
    let started = false;
    const settle = (outcome: Exit.Exit<A, E>) => {
      notStarted.delete(discard);
      if (!started) onNotStarted?.();
      Deferred.doneUnsafe(completed, Effect.succeed(outcome));
    };
    const discard = () => settle(Exit.interrupt());
    notStarted.add(discard);
    submit({
      type: 'Run',
      key: copyKey(key),
      policy,
      effect: Effect.suspend(() => {
        started = true;
        notStarted.delete(discard);
        return effect.pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              value = result;
            }),
          ),
        );
      }),
      // A task's typed failure is published in the model, so it is not reported again.
      published,
      onDiscard: () => settle(Exit.interrupt()),
      onSettled: (exit, reason) => {
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
          settle(Exit.failCause(exit.cause as Cause.Cause<E>));
        else if (reason || Exit.isFailure(exit)) settle(Exit.interrupt());
        else settle(Exit.succeed(value));
      },
    });
    return { await: Deferred.await(completed) };
  };
  let task: ReturnType<typeof ownedTask> | undefined;
  return {
    source: { model: source.model, send: source.send, subscribe: source.subscribe, dispose, close },
    read,
    patch,
    edit: (key, change) => {
      if (!disposed) {
        const changes: Partial<Model> = {};
        changes[key] = change(
          (read() as Model)[key] as Snapshot<Model[typeof key]>,
        ) as Model[typeof key];
        patch(changes);
      }
    },
    run,
    task: ((key: RunKey, effect: Effect.Effect<unknown, unknown, never>, policy: RunPolicy) =>
      (task ??= ownedTask(run as RunWithDiscard, read, patch as never, () => disposed))(
        key,
        effect,
        policy,
      )) as unknown as ModelOwner<Model, R>['task'],
    cancel: (key) => submit({ type: 'Cancel', key }),
    awaitIdle: source.awaitIdle,
    get disposed() {
      return disposed;
    },
    close,
    own(resource) {
      const owned: OwnedResource =
        typeof resource === 'function' ? { dispose: resource } : resource;
      if (disposed) owned.dispose();
      else cleanups.push(owned);
      return resource;
    },
    dispose,
  };
}

/** `run` with a callback for requests that settle without starting. Internal. */
export type RunWithDiscard = (
  key: RunKey,
  effect: Effect.Effect<unknown, unknown, never>,
  policy: RunPolicy,
  onNotStarted?: () => void,
  published?: boolean,
) => OwnedRun<unknown, unknown>;
/**
 * The `task` of an owner: `run`, publishing the work's `AsyncResult` through `read`/`patch`.
 * Internal; shared by `modelOwner` and component owners.
 */
export function ownedTask(
  run: RunWithDiscard,
  read: () => object,
  patch: (changes: Record<string | number, unknown>) => void,
  disposed: () => boolean,
) {
  // Per task key: the newest started run, runs still executing, and requests not yet started.
  const tasks = new KeyMap<{ newest: number; running: number; pending: number }>();
  return (
    key: RunKey,
    effect: Effect.Effect<unknown, unknown, never>,
    policy: RunPolicy,
  ): OwnedRun<unknown, unknown> => {
    const [field, row] = Array.isArray(key)
      ? (key as unknown as readonly [string, string | number])
      : [key as string | number, undefined];
    const current = (): AsyncResult.AsyncResult<unknown, unknown> => {
      const value = (read() as Record<string | number, unknown>)[field];
      const result =
        row === undefined ? value : (value as Record<string, unknown> | undefined)?.[row];
      return AsyncResult.isAsyncResult(result) ? result : AsyncResult.initial();
    };
    const publish = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
      if (result === current()) return;
      const value =
        row === undefined
          ? result
          : { ...(read() as Record<string | number, object | undefined>)[field], [row]: result };
      patch({ [field]: value });
    };
    let state = tasks.get(key);
    if (!state) tasks.set(key, (state = { newest: 0, running: 0, pending: 0 }));
    const entry = state;
    const release = () => {
      if (entry.pending === 0 && entry.running === 0 && tasks.get(key) === entry) tasks.delete(key);
    };
    let counted = !disposed();
    if (counted) entry.pending++;
    const admitted = () => {
      if (!counted) return;
      counted = false;
      entry.pending--;
    };
    return run(
      key,
      Effect.suspend(() => {
        admitted();
        const generation = ++entry.newest;
        entry.running++;
        publish(AsyncResult.waiting(current()));
        return Effect.scoped(effect).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              entry.running--;
              // A run replaced by a newer one leaves the newer run's state alone.
              if (generation === entry.newest) {
                const waiting = entry.pending > 0;
                const previous = current();
                if (Exit.isSuccess(exit)) publish(AsyncResult.success(exit.value, { waiting }));
                else if (!Cause.hasInterruptsOnly(exit.cause))
                  publish(
                    AsyncResult.failureWithPrevious(exit.cause, {
                      previous: Option.some(previous),
                      waiting,
                    }),
                  );
                else if (!waiting) publish(stopWaiting(previous));
              }
              release();
            }),
          ),
        );
      }),
      policy,
      () => {
        admitted();
        if (entry.pending === 0 && entry.running === 0 && entry.newest > 0) {
          const previous = current();
          if (previous.waiting) publish(stopWaiting(previous));
        }
        release();
      },
      true,
    );
  };
}

function stopWaiting<A, E>(result: AsyncResult.AsyncResult<A, E>): AsyncResult.AsyncResult<A, E> {
  if (!result.waiting) return result;
  if (AsyncResult.isInitial(result)) return AsyncResult.initial();
  if (AsyncResult.isSuccess(result)) return AsyncResult.success(result.value);
  return AsyncResult.failureWithPrevious(result.cause, { previous: Option.some(result) });
}
