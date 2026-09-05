import { Cause, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { component } from './component.js';
import type { View } from './dom.js';
import { effectCommand, type Send } from './program.js';
import { patchModel } from './state.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';

export type TaskModel<Props, State, A, E = unknown> = State & {
  readonly props: Props;
  readonly task: AsyncResult.AsyncResult<A, E>;
};
export type TaskMessage<State, Input> =
  | { type: 'Run'; input: Input }
  | { type: 'Fields'; fields: Partial<State> & { props?: never; task?: never } }
  | { type: 'Cancel' };
type Settlement<A, E> = { type: 'Succeeded'; value: A } | { type: 'Failed'; cause: Cause.Cause<E> };

/**
 * One owned async action and local editable fields; policy is part of its public behavior.
 * Compatibility factory for existing single-task components. New components can use
 * defineTasks(...).tasks(...).view(view(...)) to establish inference before JSX.
 */
export function taskComponent<Props, State extends object, Input, A, E = unknown, R = never>(
  definition: {
    init: (props: Props) => State & { props?: never; task?: never };
    identity?: (props: Props) => unknown;
    task: {
      policy: 'drop' | 'replace';
      run: (model: State & { readonly props: Props }, input: Input) => Effect.Effect<A, E, R>;
    };
    view: View<TaskModel<Props, State, A, E>, TaskMessage<State, Input>>;
  } & ([R] extends [never] ? { runtime?: UiRuntime<R> } : { runtime: UiRuntime<R> }),
): View<Props, never> {
  type Model = TaskModel<Props, State, A, E>;
  const runtime = definition.runtime ?? (defaultUiRuntime as UiRuntime<R>);
  type Message = TaskMessage<State, Input> | Settlement<A, E>;
  const init = (props: Props): Model => ({
    ...definition.init(props),
    props,
    task: AsyncResult.initial(),
  });
  return component<Props, Model, Message>({
    init,
    receive: (model, props) =>
      definition.identity &&
      !Object.is(definition.identity(model.props), definition.identity(props))
        ? { model: init(props), cancel: ['task'] }
        : { model: Object.is(model.props, props) ? model : { ...model, props } },
    update: (model, message) => {
      switch (message.type) {
        case 'Fields': {
          const next = patchModel<State>(model, message.fields);
          return {
            model: next === model ? model : { ...next, props: model.props, task: model.task },
          };
        }
        case 'Run':
          if (definition.task.policy === 'drop' && model.task.waiting) return { model };
          return {
            model: { ...model, task: AsyncResult.waiting(model.task) },
            commands: [
              effectCommand(
                'task',
                () => runtime.provide(definition.task.run(model, message.input)),
                {
                  onSuccess: (value): Message => ({ type: 'Succeeded', value }),
                  onFailure: (cause): Message => ({ type: 'Failed', cause }),
                },
              ),
            ],
          };
        case 'Cancel':
          return { model: { ...model, task: AsyncResult.initial() }, cancel: ['task'] };
        case 'Succeeded':
          return { model: { ...model, task: AsyncResult.success(message.value) } };
        case 'Failed':
          return {
            model: {
              ...model,
              task: AsyncResult.failureWithPrevious(message.cause, {
                previous: Option.some(model.task),
              }),
            },
          };
      }
    },
    view: definition.view,
  });
}

/** Stable methods when bound once in a compiled view's const declaration. */
export function taskControls<State, Input>(send: Send<TaskMessage<State, Input>>) {
  return {
    run: (input: Input) => send({ type: 'Run', input }),
    patch: (fields: Partial<State> & { props?: never; task?: never }) =>
      send({ type: 'Fields', fields }),
    cancel: () => send({ type: 'Cancel' }),
  };
}
