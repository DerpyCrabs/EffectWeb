import { commandSlot } from './program.js';
import type { Snapshot } from './snapshot.js';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import type * as Scope from 'effect/Scope';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import type { UiLoad } from './load.js';
import { loadEffect } from './load.js';
import { component } from './component.js';
import type { UiRuntime } from './runtime.js';
import type { View } from './dom.js';
import { effectCommand, type Transition } from './program.js';
const commandLoad = commandSlot('load');

export interface ResourceModel<Props, A, E = unknown> {
  readonly props: Props;
  readonly key: string | undefined;
  readonly result: AsyncResult.AsyncResult<A, E>;
}
export type ResourceMessage = { type: 'Retry' };
type InternalMessage<A, E> =
  | ResourceMessage
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
      props: Snapshot<Props>,
    ) => { key: string; load: () => UiLoad<A, E, R | Scope.Scope>; delay?: number } | undefined;
    view: View<ResourceModel<Props, A, E>, ResourceMessage>;
  } & ([Exclude<R, Scope.Scope>] extends [never]
    ? { runtime?: UiRuntime<R> }
    : { runtime: UiRuntime<R> }),
): View<Props, never> {
  const runtime = definition.runtime;
  const request = (
    model: ResourceModel<Props, A, E>,
    retry = false,
  ): Transition<ResourceModel<Props, A, E>, InternalMessage<A, E>> => {
    const selected = definition.request(model.props as Snapshot<Props>);
    if (!retry && selected?.key === model.key) return { model };
    if (!selected)
      return {
        model: { ...model, key: undefined, result: AsyncResult.initial<A, E>() },
        cancel: [commandLoad],
      };
    return {
      model: {
        ...model,
        key: selected.key,
        result: AsyncResult.waiting(
          selected.key === model.key ? model.result : AsyncResult.initial<A, E>(),
        ),
      },
      commands: [
        effectCommand(
          commandLoad,
          () => {
            const work = selected.delay
              ? Effect.sleep(selected.delay).pipe(Effect.andThen(loadEffect(selected.load)))
              : loadEffect(selected.load);
            return runtime
              ? runtime.provideScoped(work)
              : (work as Effect.Effect<A, E, Scope.Scope>);
          },
          {
            policy: 'replace',
            onSuccess: (value): InternalMessage<A, E> => ({ type: 'Loaded', value }),
            onFailure: (cause): InternalMessage<A, E> => ({ type: 'Failed', cause }),
          },
        ),
      ],
    };
  };
  return component<Props, ResourceModel<Props, A, E>, InternalMessage<A, E>>({
    init: (props) => ({
      props: props as Props,
      key: undefined,
      result: AsyncResult.initial<A, E>(),
    }),
    receive: (model, props) =>
      request({ ...(model as ResourceModel<Props, A, E>), props: props as Props }),
    update: (snapshot, message) => {
      // Internal commands preserve domain types; the public reducer boundary is immutable.
      const model = snapshot as ResourceModel<Props, A, E>;
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
