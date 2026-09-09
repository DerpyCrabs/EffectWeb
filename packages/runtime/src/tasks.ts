import type { Snapshot } from './snapshot.js';
import type { ModelOwner, TaskPolicy } from './owner.js';
import { Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
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
  readonly run: (model: Snapshot<Model>, input: Input) => Effect.Effect<A, E, R>;
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
  name?: string;
};
interface ControllerTask<R> {
  readonly run: (...args: never[]) => Effect.Effect<unknown, unknown, R>;
  readonly policy: TaskPolicy;
  /** Actions sharing a slot share cancellation and concurrency rules. Defaults to a fresh operation identity for this definition. */
  readonly slot?: CommandSlot;
}
export function defineTasks<
  Owner extends Pick<ModelOwner<object>, 'run'>,
  T extends Record<string, ControllerTask<Effect.Services<Parameters<Owner['run']>[1]>>>,
>(
  owner: Owner,
  definitions: T,
): { readonly [K in keyof T]: (...args: Parameters<T[K]['run']>) => void };
export function defineTasks<Props, State extends object, R>(
  definition: Init<Props, State> & { runtime: UiRuntime<R> },
): ReturnType<typeof taskBuilder<Props, State, R>>;
export function defineTasks<Props, State extends object>(
  definition: Init<Props, State>,
): ReturnType<typeof taskBuilder<Props, State, never>>;
export function defineTasks<Props, State extends object, R>(
  definition:
    | (Init<Props, State> & { runtime?: UiRuntime<R> })
    | Pick<ModelOwner<object, R>, 'run'>,
  definitions?: Record<string, ControllerTask<R>>,
): unknown {
  if ('run' in definition) {
    const actions = Object.create(null) as Record<string, (...args: never[]) => void>;
    for (const [name, task] of Object.entries(definitions!)) {
      const slot = task.slot ?? commandSlot(name);
      actions[name] = (...args) =>
        definition.run(
          slot,
          Effect.suspend(() => task.run(...args)),
          task.policy,
        );
    }
    return actions;
  }
  return taskBuilder(definition, definition.runtime ?? (defaultUiRuntime as UiRuntime<R>));
}

function stopWaiting<A, E>(result: AsyncResult.AsyncResult<A, E>): AsyncResult.AsyncResult<A, E> {
  if (!result.waiting) return result;
  if (AsyncResult.isInitial(result)) return AsyncResult.initial();
  if (AsyncResult.isSuccess(result)) return AsyncResult.success(result.value);
  return AsyncResult.failureWithPrevious(result.cause, { previous: Option.some(result) });
}
function taskBuilder<Props, State extends object, R>(
  definition: Init<Props, State>,
  runtime: UiRuntime<R>,
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
      const create = (props: Props | Snapshot<Props>): RunningProgram<Model, Message> => {
        const source: RunningProgram<Model, Internal> = program<Model, Internal>({
          initial: init(props as Snapshot<Props>),
          ...(definition.name ? { name: definition.name } : {}),
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
                          runtime.provide(
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
