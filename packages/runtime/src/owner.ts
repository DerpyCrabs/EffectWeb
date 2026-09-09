import { protectSnapshot, type Snapshot } from './snapshot.js';
import { Effect } from 'effect';
import {
  program,
  type Command,
  type Program,
  type TaskPolicy,
  type CommandSlot,
} from './program.js';
import { patchModel } from './state.js';
import { runAll, reportError, type ReportError } from './errors.js';
import type { UiRuntime } from './runtime.js';

export type { TaskPolicy } from './program.js';
export interface DisposableOwner {
  readonly disposed: boolean;
  readonly own: <A extends { dispose(): void }>(resource: A) => A;
}
export interface ModelOwner<Model extends object, R = never> extends DisposableOwner {
  readonly source: Program<Model, never>;
  readonly read: () => Snapshot<Model>;
  /** Expose only controller-selected editable fields to a view. */
  readonly fields: <const Keys extends readonly (keyof Model)[]>(
    ...keys: Keys
  ) => {
    readonly [K in Keys[number]]: (value: Model[K] | Snapshot<Model[K]>) => void;
  };
  readonly patch: (changes: Partial<Model> | Partial<Snapshot<Model>>) => void;
  readonly edit: <K extends keyof Model>(
    key: K,
    change: (value: Snapshot<Model[K]>) => Model[K] | Snapshot<Model[K]>,
  ) => void;
  /** Synchronous transaction. Reads see staged changes; a throw discards changes and work. */
  readonly transaction: <A>(
    work: () => A & (A extends PromiseLike<unknown> ? never : unknown),
  ) => A;
  readonly run: (
    slot: CommandSlot,
    effect: Effect.Effect<unknown, unknown, R>,
    policy: TaskPolicy,
  ) => void;
  readonly cancel: (slot: CommandSlot) => void;
  readonly isRunning: (slot: CommandSlot) => boolean;
  readonly awaitIdle: (slot?: CommandSlot) => Promise<void>;
  /** Interrupt and join work before closing owned dependencies in reverse order. */
  readonly close: () => Promise<void>;
  readonly dispose: () => void;
}

type Options = { name?: string; onDefect?: ReportError };
export function modelOwner<Model extends object>(
  initial: Model,
  options?: Options,
): ModelOwner<Model>;
export function modelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { runtime: UiRuntime<R> },
): ModelOwner<Model, R>;
export function modelOwner<Model extends object, R>(
  initial: Model,
  options: Options & { runtime?: UiRuntime<R> } = {},
): ModelOwner<Model, R> {
  type Operation =
    | { type: 'Patch'; changes: Partial<Model> | Partial<Snapshot<Model>> }
    | {
        type: 'Run';
        slot: CommandSlot;
        effect: Effect.Effect<unknown, unknown, R>;
        policy: TaskPolicy;
      }
    | { type: 'Cancel'; slot: CommandSlot };
  type Batch = readonly Operation[];
  let disposed = false;
  let staged: { model: Model; operations: Operation[] } | undefined;
  const cleanups: Array<{ dispose(): void; close?(): Promise<void> }> = [];
  let closing: Promise<void> | undefined;
  const source = program<Model, Batch>({
    initial,
    ...options,
    update(snapshot, operations) {
      let model = snapshot as Model;
      const single = operations.length === 1 ? operations[0] : undefined;
      if (single?.type === 'Patch')
        return { model: patchModel(model, single.changes as Partial<Model>) };
      const commands: Command<Batch, R>[] = [];
      const cancel = new Set<CommandSlot>();
      for (const operation of operations) {
        if (operation.type === 'Patch')
          model = patchModel(model, operation.changes as Partial<Model>);
        else if (operation.type === 'Cancel') {
          cancel.add(operation.slot);
          for (let index = commands.length - 1; index >= 0; index--)
            if (commands[index]!.slot === operation.slot) commands.splice(index, 1);
        } else {
          const { slot, effect, policy } = operation;
          commands.push({ slot, policy, action: Effect.asVoid(effect) });
        }
      }
      return {
        model,
        cancel: [...cancel],
        commands: commands.map((command) =>
          options.runtime ? options.runtime.command(command) : (command as Command<Batch>),
        ),
      };
    },
  });
  const read = (): Snapshot<Model> =>
    protectSnapshot(staged?.model ?? source.model()) as Snapshot<Model>;
  const submit = (operation: Operation) => {
    if (disposed) return;
    if (staged) {
      staged.operations.push(operation);
      if (operation.type === 'Patch')
        staged.model = patchModel(staged.model, operation.changes as Partial<Model>);
    } else source.send([operation]);
  };
  const patch = (changes: Partial<Model> | Partial<Snapshot<Model>>) =>
    submit({ type: 'Patch', changes });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    source.dispose();
    runAll(
      cleanups
        .splice(0)
        .reverse()
        .map((resource) => () => resource.dispose()),
      options.onDefect ?? reportError,
    );
  };
  return {
    source: { model: source.model, send: source.send, subscribe: source.subscribe, dispose },
    read,
    patch,
    fields: (...keys) => {
      const controls = Object.create(null) as {
        [K in (typeof keys)[number]]: (value: Model[K] | Snapshot<Model[K]>) => void;
      };
      for (const key of keys) {
        Object.defineProperty(controls, key, {
          enumerable: true,
          value: (value: unknown) => patch({ [key]: value } as Partial<Model>),
        });
      }
      return Object.freeze(controls);
    },
    edit: (key, change) => {
      if (!disposed) {
        const changes: Partial<Model> = {};
        changes[key] = change(
          (read() as Model)[key] as Snapshot<Model[typeof key]>,
        ) as Model[typeof key];
        patch(changes);
      }
    },
    transaction(work) {
      if (disposed) throw new Error('Cannot start a transaction on a disposed model owner.');
      const parent = staged;
      const batch = { model: read() as Model, operations: [] as Operation[] };
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
    run: (slot, effect, policy) => submit({ type: 'Run', slot, effect, policy }),
    cancel: (slot) => submit({ type: 'Cancel', slot }),
    isRunning: (slot) => source.activeSlots().includes(slot),
    awaitIdle: source.awaitIdle,
    get disposed() {
      return disposed;
    },
    close() {
      if (closing) return closing;
      disposed = true;
      const resources = cleanups.splice(0).reverse();
      let finish!: () => void;
      let fail!: (error: unknown) => void;
      closing = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const closeResources = async () => {
        await source.close();
        const errors: unknown[] = [];
        for (const resource of resources) {
          try {
            if (resource.close) await resource.close();
            else resource.dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, 'Owner cleanup failed.');
      };
      closeResources().then(finish, fail);
      return closing;
    },
    own(resource) {
      if (disposed) resource.dispose();
      else cleanups.push(resource);
      return resource;
    },
    dispose,
  };
}
