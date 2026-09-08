import { commandSlot } from './program.js';
import type { Snapshot } from './snapshot.js';
import { Cause, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { programView } from './component.js';
import type { View } from './dom.js';
import {
  effectCommand,
  type Send,
  type TaskPolicy,
  type RunningProgram,
  type Program,
} from './program.js';
import { patchModel } from './state.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

const commandTask = commandSlot('task');

export type TaskModel<Props, State, A, E = unknown> = State & {
  readonly props: Props;
  readonly task: AsyncResult.AsyncResult<A, E>;
};
export type TaskMessage<State, Input> =
  | { type: 'Run'; input: Input }
  | {
      type: 'Fields';
      fields: (Partial<State> | Partial<Snapshot<State>>) & { props?: never; task?: never };
    }
  | { type: 'Cancel' };
type Settlement<A, E> = { type: 'Succeeded'; value: A } | { type: 'Failed'; cause: Cause.Cause<E> };

/**
 * One owned async action and local editable fields; policy is part of its public behavior.
 * Compatibility factory for existing single-task components. New components can use
 * defineTasks(...).tasks(...).view(view(...)) to establish inference before JSX.
 */
export function taskComponent<Props, State extends object, Input, A, E = unknown, R = never>(
  definition: {
    init: (props: Snapshot<Props>) => (State | Snapshot<State>) & { props?: never; task?: never };
    identity?: (props: Snapshot<Props>) => unknown;
    task: {
      policy: Exclude<TaskPolicy, 'parallel'>;
      run: (
        model: Snapshot<State & { readonly props: Props }>,
        input: Input,
      ) => Effect.Effect<A, E, R>;
    };
    view: View<TaskModel<Props, State, A, E>, TaskMessage<State, Input>>;
  } & ([R] extends [never] ? { runtime?: UiRuntime<R> } : { runtime: UiRuntime<R> }),
): View<Props, never> {
  type Model = TaskModel<Props, State, A, E>;
  const runtime = definition.runtime ?? (defaultUiRuntime as UiRuntime<R>);
  type Message =
    | TaskMessage<State, Input>
    | Settlement<A, E>
    | { type: 'Input'; props: Snapshot<Props> };
  const init = (props: Snapshot<Props>): Model =>
    ({ ...(definition.init(props) as State), props, task: AsyncResult.initial() }) as Model;
  const owners = new WeakMap<
    Program<Model, TaskMessage<State, Input>>,
    RunningProgram<Model, Message>
  >();
  return programView<Props, Model, TaskMessage<State, Input>>({
    create(props) {
      const source: RunningProgram<Model, Message> = runtime.program<Model, Message>({
        initial: init(props),
        update: (snapshot, message) => {
          // The public task receives the immutable snapshot; reconstruction stays internal.
          const model = snapshot as Model;
          switch (message.type) {
            case 'Input':
              return definition.identity &&
                !Object.is(
                  definition.identity(model.props as Snapshot<Props>),
                  definition.identity(message.props),
                )
                ? { model: init(message.props), cancel: [commandTask] }
                : {
                    model: Object.is(model.props, message.props)
                      ? model
                      : { ...model, props: message.props as Props },
                  };
            case 'Fields': {
              const next = patchModel<State>(model, message.fields as Partial<State>);
              return {
                model: next === model ? model : { ...next, props: model.props, task: model.task },
              };
            }
            case 'Run':
              if (definition.task.policy === 'drop' && model.task.waiting) return { model };
              return {
                model: { ...model, task: AsyncResult.waiting(model.task) },
                commands: [
                  {
                    ...effectCommand(
                      commandTask,
                      () =>
                        definition.task.run(
                          snapshot as unknown as Snapshot<State & { readonly props: Props }>,
                          message.input,
                        ),
                      {
                        policy: definition.task.policy,
                        onSuccess: (value): Message => ({ type: 'Succeeded', value }),
                        onFailure: (cause): Message => ({ type: 'Failed', cause }),
                      },
                    ),
                    policy: definition.task.policy,
                  },
                ],
              };
            case 'Cancel':
              return {
                model: { ...model, task: AsyncResult.initial<A, E>() },
                cancel: [commandTask],
              };
            case 'Succeeded':
              return {
                model: {
                  ...model,
                  task: AsyncResult.success(message.value, {
                    waiting: source.activeSlots().includes(commandTask),
                  }),
                },
              };
            case 'Failed':
              return {
                model: {
                  ...model,
                  task: AsyncResult.failureWithPrevious(message.cause, {
                    previous: Option.some(model.task),
                    waiting: source.activeSlots().includes(commandTask),
                  }),
                },
              };
          }
        },
      });
      owners.set(source, source);
      return source;
    },
    receive: (source, props) => owners.get(source)!.send({ type: 'Input', props }),
    view: definition.view,
  });
}

/** Stable methods when bound once in a compiled view's const declaration. */
export function taskControls<State, Input>(send: Send<TaskMessage<State, Input>>) {
  return {
    run: (input: Input) => send({ type: 'Run', input }),
    patch: (
      fields: (Partial<State> | Partial<Snapshot<State>>) & { props?: never; task?: never },
    ) => send({ type: 'Fields', fields }),
    cancel: () => send({ type: 'Cancel' }),
  };
}
