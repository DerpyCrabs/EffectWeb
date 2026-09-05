import { protectSnapshot, checkSnapshotsByDefault, type Snapshot } from './snapshot.js';
import { Effect } from 'effect';
import { program, type Command, type Program } from './program.js';
import { patchModel } from './state.js';
import { runAll, reportError, type ReportError } from './errors.js';
import type { UiRuntime } from './runtime.js';

export type TaskPolicy = 'replace' | 'drop' | 'parallel';
export interface DisposableOwner {
  readonly disposed: boolean;
  readonly own: <A extends { dispose(): void }>(resource: A) => A;
}
export interface ModelOwner<Model extends object, R = never> extends DisposableOwner {
  readonly source: Program<Model, never>;
  readonly read: () => Snapshot<Model>;
  readonly patch: (changes: Partial<Model>) => void;
  readonly edit: <K extends keyof Model>(
    key: K,
    change: (value: Snapshot<Model[K]>) => Snapshot<Model[K]>,
  ) => void;
  /** Synchronous transaction. Reads see staged changes; a throw discards changes and work. */
  readonly transaction: <A>(
    work: () => A & (A extends PromiseLike<unknown> ? never : unknown),
  ) => A;
  readonly run: (
    slot: string,
    effect: Effect.Effect<unknown, unknown, R>,
    policy?: TaskPolicy,
  ) => void;
  readonly cancel: (slot: string) => void;
  readonly isRunning: (slot: string) => boolean;
  readonly awaitIdle: () => Promise<void>;
  readonly dispose: () => void;
}

type Options = { checkSnapshots?: boolean; name?: string; onDefect?: ReportError };
export function modelOwner<Model extends object>(
  initial: Model,
  options?: Options,
): ModelOwner<Model>;
export function modelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { runtime: UiRuntime<R> },
): ModelOwner<Model, R>;
/** Immutable model publication and task ownership, using the same program queue as components. */
export function modelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { runtime?: UiRuntime<R> } = {},
): ModelOwner<Model, R> {
  type Operation =
    | { type: 'Patch'; changes: Partial<Model> }
    | { type: 'Run'; slot: string; effect: Effect.Effect<unknown, unknown, R>; policy: TaskPolicy }
    | { type: 'Cancel'; slot: string };
  type Batch = readonly Operation[];
  let disposed = false,
    nextTask = 0;
  let staged: { model: Model; operations: Operation[] } | undefined;
  const groups = new Map<string, Set<string>>();
  const cleanups: Array<() => void> = [];
  const source = program<Model, Batch>({
    initial,
    ...options,
    update(model, operations) {
      const single = operations.length === 1 ? operations[0] : undefined;
      if (single?.type === 'Patch') return { model: patchModel(model, single.changes) };
      const commands = new Map<string, Command<Batch, R>>();
      const cancel = new Set<string>();
      const stop = (slot: string) => {
        for (const key of groups.get(slot) ?? []) {
          cancel.add(key);
          commands.delete(key);
        }
        groups.delete(slot);
      };
      for (const operation of operations) {
        if (operation.type === 'Patch') model = patchModel(model, operation.changes);
        else if (operation.type === 'Cancel') stop(operation.slot);
        else {
          const { slot, effect, policy } = operation;
          if (policy === 'drop' && groups.has(slot)) continue;
          if (policy === 'replace') stop(slot);
          const key = `${slot}:${++nextTask}`;
          const group = groups.get(slot) ?? new Set<string>();
          groups.set(slot, group);
          group.add(key);
          commands.set(key, {
            slot: key,
            action: Effect.asVoid(effect).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  group.delete(key);
                  if (!group.size && groups.get(slot) === group) groups.delete(slot);
                }),
              ),
            ),
          });
        }
      }
      return {
        model,
        cancel: [...cancel],
        commands: [...commands.values()].map((command) =>
          options.runtime ? options.runtime.command(command) : (command as Command<Batch>),
        ),
      };
    },
  });
  const read = () =>
    protectSnapshot(
      staged?.model ?? source.model(),
      options.checkSnapshots ?? checkSnapshotsByDefault,
    );
  const submit = (operation: Operation) => {
    if (disposed) return;
    if (staged) {
      staged.operations.push(operation);
      if (operation.type === 'Patch') staged.model = patchModel(staged.model, operation.changes);
    } else source.send([operation]);
  };
  const patch = (changes: Partial<Model>) => submit({ type: 'Patch', changes });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    source.dispose();
    groups.clear();
    runAll(cleanups.splice(0).reverse(), options.onDefect ?? reportError);
  };
  return {
    source: { model: source.model, send: source.send, subscribe: source.subscribe, dispose },
    read,
    patch,
    edit: (key, change) => {
      if (!disposed) {
        const changes: Partial<Model> = {};
        // Readonly changes remain immutable model data; no clone is needed for a no-op.
        changes[key] = change(read()[key]) as Model[typeof key];
        patch(changes);
      }
    },
    transaction(work) {
      if (disposed) throw new Error('Cannot start a transaction on a disposed model owner.');
      const parent = staged;
      const batch = { model: read(), operations: [] as Operation[] };
      staged = batch;
      try {
        const result = work();
        if (
          result &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result &&
          typeof result.then === 'function'
        )
          throw new TypeError(
            'Model transactions must be synchronous. Run async work as an owned Effect.',
          );
        staged = parent;
        if (!disposed) {
          if (parent) {
            parent.model = batch.model;
            parent.operations.push(...batch.operations);
          } else if (batch.operations.length) source.send(batch.operations);
        }
        return result;
      } finally {
        staged = parent;
      }
    },
    run: (slot, effect, policy = 'replace') => submit({ type: 'Run', slot, effect, policy }),
    cancel: (slot) => submit({ type: 'Cancel', slot }),
    isRunning: (slot) => groups.has(slot),
    awaitIdle: source.awaitIdle,
    get disposed() {
      return disposed;
    },
    own(resource) {
      if (disposed) resource.dispose();
      else cleanups.push(() => resource.dispose());
      return resource;
    },
    dispose,
  };
}
