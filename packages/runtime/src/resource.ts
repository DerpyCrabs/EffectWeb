import { Cause, Effect, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import type { UiLoad } from './load.js';
import { loadEffect } from './load.js';
import { component } from './component.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';
import type { View } from './dom.js';
import { effectCommand, type Transition } from './program.js';
export interface ResourceModel<Props, A, E = unknown> {
  readonly props: Props;
  readonly key: string | undefined;
  readonly result: AsyncResult.AsyncResult<A, E>;
}
export type ResourceMessage<A, E = unknown> =
  | { type: 'Retry' }
  | { type: 'Loaded'; value: A }
  | { type: 'Failed'; cause: Cause.Cause<E> };
export const available = <A>(result: AsyncResult.AsyncResult<A, unknown>) =>
  Option.getOrUndefined(AsyncResult.value(result));
export const resourceError = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  if (!AsyncResult.isFailure(result)) return '';
  const error = Cause.squash(result.cause);
  return error instanceof Error ? error.message : String(error);
};

/** A replaceable request owns one result. Key changes clear it; refreshes preserve the last success. */
export function resourceComponent<Props, A, E = unknown, R = never>(
  definition: {
    request: (
      props: Props,
    ) => { key: string; load: () => UiLoad<A, E, R>; delay?: number } | undefined;
    view: View<ResourceModel<Props, A, E>, ResourceMessage<A, E>>;
  } & ([R] extends [never] ? { runtime?: UiRuntime<R> } : { runtime: UiRuntime<R> }),
): View<Props, never> {
  const runtime = definition.runtime ?? (defaultUiRuntime as UiRuntime<R>);
  const request = (
    model: ResourceModel<Props, A, E>,
    retry = false,
  ): Transition<ResourceModel<Props, A, E>, ResourceMessage<A, E>> => {
    const selected = definition.request(model.props);
    if (!retry && selected?.key === model.key) return { model };
    if (!selected)
      return {
        model: { ...model, key: undefined, result: AsyncResult.initial() },
        cancel: ['load'],
      };
    return {
      model: {
        ...model,
        key: selected.key,
        result: AsyncResult.waiting(
          selected.key === model.key ? model.result : AsyncResult.initial(),
        ),
      },
      commands: [
        effectCommand(
          'load',
          () =>
            runtime.provide(
              selected.delay
                ? Effect.sleep(selected.delay).pipe(Effect.andThen(loadEffect(selected.load)))
                : loadEffect(selected.load),
            ),
          {
            onSuccess: (value): ResourceMessage<A, E> => ({ type: 'Loaded', value }),
            onFailure: (cause): ResourceMessage<A, E> => ({ type: 'Failed', cause }),
          },
        ),
      ],
    };
  };
  return component<Props, ResourceModel<Props, A, E>, ResourceMessage<A, E>>({
    init: (props) => ({ props, key: undefined, result: AsyncResult.initial() }),
    receive: (model, props) => request({ ...model, props }),
    update: (model, message) => {
      switch (message.type) {
        case 'Retry':
          return request(model, true);
        case 'Loaded':
          return { model: { ...model, result: AsyncResult.success(message.value) } };
        case 'Failed':
          return {
            model: {
              ...model,
              result: AsyncResult.failureWithPrevious(message.cause, {
                previous: Option.some(model.result),
              }),
            },
          };
      }
    },
    view: definition.view,
  });
}
