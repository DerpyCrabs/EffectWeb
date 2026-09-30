import type { Snapshot } from './snapshot.js';
import type { ModelOwner, TaskPolicy } from './owner.js';
import * as Cause from 'effect/Cause';
import * as Exit from 'effect/Exit';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { programView } from './component.js';
import type { View } from './dom.js';
import {
  commandSlot,
  type CommandSlot,
  effectCommand,
  program,
  type Send,
  type RunningProgram,
} from './program.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';
import { patchModel } from './state.js';

export interface TaskDefinition<Model, Input, A, E, R = never> {
  readonly policy: Exclude<TaskPolicy, 'parallel'>;
  readonly run: (model: Snapshot<Model>, input: Input) => Effect.Effect<A, E, R | Scope.Scope>;
  /** Domain identity, compared after fields or props change. Resets this slot only. */
  readonly identity?: (model: Snapshot<Model>) => unknown;
}
type Definitions<Model, R> = Record<string, TaskDefinition<Model, never, unknown, unknown, R>>;
type AnyDefinitions = Record<
  string,
  { readonly run: (...args: never[]) => Effect.Effect<unknown, unknown, unknown> }
>;
type Input<T extends AnyDefinitions[string]> =
  Parameters<T['run']> extends [unknown, ...infer Inputs]
    ? Inputs extends []
      ? void
      : Inputs[0]
    : void;
type InputArguments<T extends AnyDefinitions[string]> =
  Input<T> extends void
    ? [input?: Input<T>]
    : Parameters<T['run']> extends [unknown, unknown, ...unknown[]]
      ? [input: Input<T>]
      : [input?: Input<T>];
export type TaskResults<T extends AnyDefinitions> = {
  readonly [K in keyof T]: AsyncResult.AsyncResult<
    Effect.Success<ReturnType<T[K]['run']>>,
    Effect.Error<ReturnType<T[K]['run']>>
  >;
};
export type TasksModel<Props, State, T extends AnyDefinitions> = State & {
  readonly props: Props;
  readonly tasks: TaskResults<T>;
};
export type TasksMessage<State, T extends AnyDefinitions> =
  | {
      readonly type: 'Fields';
      readonly fields: (Partial<State> | Partial<Snapshot<State>>) & {
        readonly props?: never;
        readonly tasks?: never;
      };
    }
  | { readonly type: 'Cancel' | 'Reset'; readonly task: keyof T }
  | {
      [K in keyof T]: { readonly type: 'Run'; readonly task: K; readonly input: Input<T[K]> };
    }[keyof T];

type Init<Props, State> = {
  init: (
    props: Snapshot<Props>,
  ) => (State | Snapshot<State>) & { readonly props?: never; readonly tasks?: never };
  /** Changing the component entity also resets editable fields and all its tasks. */
  identity?: (props: Snapshot<Props>) => unknown;
};
interface OwnedTask<R> {
  readonly run: (...args: never[]) => Effect.Effect<unknown, unknown, R>;
  readonly policy: TaskPolicy;
  /** Tasks sharing a slot share cancellation and concurrency rules. Defaults to one slot per task. */
  readonly slot?: CommandSlot;
}
/** Model keys that can hold the task's `AsyncResult`. */
type ResultKeys<Model, A, E> = {
  [K in keyof Model]: AsyncResult.AsyncResult<A, E> extends Model[K] | Snapshot<Model[K]>
    ? K
    : never;
}[keyof Model];
type PublishedTasks<Model, R, T> = {
  readonly [K in keyof T]: OwnedTask<R> & {
    /** A model key that receives the task's `AsyncResult`: waiting, success or failure. */
    readonly result?: T[K] extends { readonly run: (...args: never[]) => infer Ran }
      ? ResultKeys<Model, Effect.Success<Ran>, Effect.Error<Ran>>
      : never;
  };
};
type TaskActions<T> = {
  readonly [K in keyof T]: T[K] extends { readonly run: (...args: infer Args) => unknown }
    ? (...args: Args) => void
    : never;
};
/**
 * Named controller actions that run through `owner.run` with a fixed policy and slot:
 * `const actions = ownedTasks(owner, { save: { run: save, policy: 'drop' } })` then
 * `actions.save(text)`. Arguments are passed to `run` when the task starts. A task with
 * `result: 'key'` publishes its `AsyncResult` into the owner's model at that key.
 */
export function ownedTasks<
  Model extends object,
  R,
  T extends PublishedTasks<Model, R | Scope.Scope, T>,
>(owner: ModelOwner<Model, R>, definitions: T): TaskActions<NoInfer<T>>;
export function ownedTasks<
  Owner extends {
    readonly run: (slot: CommandSlot, effect: Effect.Effect<never>, policy: TaskPolicy) => void;
  },
  T extends Record<
    string,
    OwnedTask<Effect.Services<Parameters<Owner['run']>[1]>> & { readonly result?: never }
  >,
>(owner: Owner, definitions: T): TaskActions<NoInfer<T>>;
export function ownedTasks(
  owner: Pick<ModelOwner<Record<string, unknown>>, 'run'> &
    Partial<Pick<ModelOwner<Record<string, unknown>>, 'read' | 'patch'>>,
  definitions: Record<string, OwnedTask<never> & { readonly result?: string }>,
): Record<string, (...args: never[]) => void> {
  const actions = Object.create(null) as Record<string, (...args: never[]) => void>;
  for (const [name, task] of Object.entries(definitions)) {
    const slot = task.slot ?? commandSlot(name);
    const key = task.result;
    if (key === undefined) {
      actions[name] = (...args) =>
        owner.run(
          slot,
          Effect.suspend(() => task.run(...args)),
          task.policy,
        );
      continue;
    }
    const current = () => owner.read!()[key] as AsyncResult.AsyncResult<unknown, unknown>;
    const publish = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
      owner.patch!({ [key]: result });
    let generation = 0;
    actions[name] = (...args) =>
      owner.run(
        slot,
        Effect.suspend(() => {
          const started = ++generation;
          publish(AsyncResult.waiting(current()));
          return task.run(...args).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                // A run replaced by a newer one leaves the newer run's state alone.
                if (started !== generation) return;
                if (Exit.isSuccess(exit)) publish(AsyncResult.success(exit.value));
                else if (Cause.hasInterruptsOnly(exit.cause)) publish(stopWaiting(current()));
                else
                  publish(
                    AsyncResult.failureWithPrevious(exit.cause, {
                      previous: Option.some(current()),
                    }),
                  );
              }),
            ),
          );
        }),
        task.policy,
      );
  }
  return actions;
}

export function defineTasks<Props, State extends object, R>(
  definition: Init<Props, State> & { runtime: UiRuntime<R> },
): ReturnType<typeof taskBuilder<Props, State, R>>;
export function defineTasks<Props, State extends object>(
  definition: Init<Props, State>,
): ReturnType<typeof taskBuilder<Props, State, never>>;
export function defineTasks<Props, State extends object, R>(
  definition: Init<Props, State> & { runtime?: UiRuntime<R> },
): unknown {
  return taskBuilder(definition, definition.runtime);
}

function stopWaiting<A, E>(result: AsyncResult.AsyncResult<A, E>): AsyncResult.AsyncResult<A, E> {
  if (!result.waiting) return result;
  if (AsyncResult.isInitial(result)) return AsyncResult.initial();
  if (AsyncResult.isSuccess(result)) return AsyncResult.success(result.value);
  return AsyncResult.failureWithPrevious(result.cause, { previous: Option.some(result) });
}
function taskBuilder<Props, State extends object, R>(
  definition: Init<Props, State>,
  runtime: UiRuntime<R> | undefined,
) {
  type Base = State & { readonly props: Props };
  return {
    tasks<T extends Definitions<Base, R>>(definitions: T) {
      type Model = TasksModel<Props, State, T>;
      type Message = TasksMessage<State, T>;
      type Internal =
        | Message
        | { type: 'Input'; props: Snapshot<Props> }
        | { type: 'Settled'; task: keyof T; result: AsyncResult.AsyncResult<unknown, unknown> };
      const names = Object.keys(definitions) as Array<keyof T & string>;
      const slots = new Map(names.map((name) => [name, commandSlot(`task:${name}`)]));
      const slot = (name: keyof T) => slots.get(name as keyof T & string)!;
      const initialResults = () =>
        Object.fromEntries(names.map((name) => [name, AsyncResult.initial()])) as TaskResults<T>;
      const init = (props: Snapshot<Props>): Model =>
        ({ ...(definition.init(props) as State), props, tasks: initialResults() }) as Model;
      const withResult = (
        model: Model,
        task: keyof T,
        result: AsyncResult.AsyncResult<unknown, unknown>,
      ): Model => ({ ...model, tasks: { ...model.tasks, [task]: result } });
      const resetIdentities = (before: Model, model: Model) => {
        const cancel: CommandSlot[] = [];
        for (const name of names) {
          const identity = definitions[name]!.identity;
          if (
            identity &&
            !Object.is(
              identity(before as unknown as Snapshot<Base>),
              identity(model as unknown as Snapshot<Base>),
            )
          ) {
            model = withResult(model, name, AsyncResult.initial());
            cancel.push(slot(name));
          }
        }
        return { model, cancel };
      };
      const owners = new WeakMap<RunningProgram<Model, Message>, RunningProgram<Model, Internal>>();
      const create = (
        props: Props | Snapshot<Props>,
        ownerRuntime: UiRuntime<never> = defaultUiRuntime,
      ): RunningProgram<Model, Message> => {
        const execution = runtime ?? (ownerRuntime as UiRuntime<R>);
        const source: RunningProgram<Model, Internal> = program<Model, Internal>({
          initial: init(props as Snapshot<Props>),
          runtime: ownerRuntime,
          update: (snapshot, message) => {
            // Internal immutable reconstruction retains the declared domain types.
            const model = snapshot as Model;
            switch (message.type) {
              case 'Input':
                if (
                  definition.identity &&
                  !Object.is(
                    definition.identity(model.props as Snapshot<Props>),
                    definition.identity(message.props),
                  )
                )
                  return { model: init(message.props), cancel: names.map(slot) };
                return resetIdentities(model, { ...model, props: message.props as Props });
              case 'Fields': {
                const next = patchModel<State>(model, message.fields as Partial<State>);
                return resetIdentities(
                  model,
                  next === model ? model : { ...next, props: model.props, tasks: model.tasks },
                );
              }
              case 'Run': {
                const task = definitions[message.task]!;
                const previous = model.tasks[message.task];
                if (task.policy === 'drop' && previous.waiting) return { model };
                return {
                  model: withResult(model, message.task, AsyncResult.waiting(previous)),
                  commands: [
                    {
                      ...effectCommand(
                        slot(message.task),
                        () =>
                          execution.provideScoped(
                            task.run(snapshot as unknown as Snapshot<Base>, message.input as never),
                          ),
                        {
                          policy: task.policy,
                          onSuccess: (value): Internal => ({
                            type: 'Settled',
                            task: message.task,
                            result: AsyncResult.success(value),
                          }),
                          onFailure: (cause): Internal => ({
                            type: 'Settled',
                            task: message.task,
                            result: AsyncResult.failure(cause),
                          }),
                        },
                      ),
                      policy: task.policy,
                    },
                  ],
                };
              }
              case 'Cancel':
                return {
                  model: withResult(model, message.task, stopWaiting(model.tasks[message.task])),
                  cancel: [slot(message.task)],
                };
              case 'Reset':
                return {
                  model: withResult(model, message.task, AsyncResult.initial()),
                  cancel: [slot(message.task)],
                };
              case 'Settled': {
                const result = AsyncResult.isFailure(message.result)
                  ? AsyncResult.failureWithPrevious(message.result.cause, {
                      previous: Option.some(model.tasks[message.task]),
                    })
                  : message.result;
                return {
                  model: withResult(
                    model,
                    message.task,
                    source.activeSlots().includes(slot(message.task))
                      ? AsyncResult.waiting(result)
                      : result,
                  ),
                };
              }
            }
          },
        });
        const exposed: RunningProgram<Model, Message> = { ...source, send: source.send };
        owners.set(exposed, source);
        return exposed;
      };
      const receive = (source: RunningProgram<Model, Message>, props: Props | Snapshot<Props>) => {
        const owner = owners.get(source);
        if (!owner) throw new Error('Task source belongs to a different definition');
        owner.send({ type: 'Input', props: props as Snapshot<Props> });
      };
      const controls = (send: Send<Message>) => ({
        run: <K extends keyof T>(task: K, ...input: InputArguments<T[K]>) =>
          send({ type: 'Run', task, input: input[0] } as Message),
        patch: (
          fields: (Partial<State> | Partial<Snapshot<State>>) & {
            readonly props?: never;
            readonly tasks?: never;
          },
        ) => send({ type: 'Fields', fields }),
        cancel: (task: keyof T) => send({ type: 'Cancel', task }),
        reset: (task: keyof T) => send({ type: 'Reset', task }),
      });
      return {
        slot,
        create,
        receive,
        controls,
        view: (view: View<Model, Message>): View<Props, never> =>
          programView<Props, Model, Message>({
            ...(definition.identity ? { identity: definition.identity } : {}),
            create,
            receive: (source, props) => receive(source as RunningProgram<Model, Message>, props),
            view,
          }),
      };
    },
  };
}
