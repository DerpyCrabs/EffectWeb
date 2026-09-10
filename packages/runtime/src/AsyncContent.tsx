import { commandSlot } from './program.js';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { component } from './component.js';
import { view, type Slot, type View } from './index.js';
import type { JSX } from './jsx.js';
import { effectCommand, type Transition } from './program.js';

const commandPending = commandSlot('pending');

export interface AsyncContentProps<A, E> {
  result: AsyncResult.AsyncResult<A, E>;
  content: Slot<A>;
  pending?: JSX.Element;
  empty?: JSX.Element;
  failure?: Slot<Cause.Cause<E>>;
  refreshing?: JSX.Element;
  pendingDelay?: number;
}
type Props = AsyncContentProps<unknown, unknown>;
type Model = { props: Props; pending: boolean; visible: boolean };
type Message = { type: 'ShowPending' };
const implementation = component<Props, Model, Message>({
  init: (props) => ({ props, pending: false, visible: false }),
  receive(model, props): Transition<Model, Message> {
    const pending = props.result.waiting && Option.isNone(AsyncResult.value(props.result));
    if (!pending)
      return { model: { props, pending: false, visible: false }, cancel: [commandPending] };
    if (model.pending && model.props.pendingDelay === props.pendingDelay)
      return { model: { ...model, props } };
    const delay = Math.max(0, props.pendingDelay ?? 0);
    return {
      model: { props, pending: true, visible: delay === 0 },
      cancel: [commandPending],
      commands:
        delay === 0
          ? []
          : [
              effectCommand(commandPending, () => Effect.sleep(delay), {
                policy: 'replace',
                onSuccess: (): Message => ({ type: 'ShowPending' }),
                onFailure: (): Message => ({ type: 'ShowPending' }),
              }),
            ],
    };
  },
  update: (model) => ({ model: { ...model, visible: true } }),
  view: view((model, _send) => {
    const props = model.props;
    const data = AsyncResult.value(props.result);
    const failure =
      AsyncResult.isFailure(props.result) && !props.result.waiting ? props.result : undefined;
    if (Option.isSome(data))
      return (
        <>
          {props.content(data.value)}
          {props.result.waiting ? props.refreshing : null}
          {failure && props.failure ? props.failure(failure.cause) : null}
        </>
      );
    if (failure && props.failure) return props.failure(failure.cause);
    if (model.pending) return model.visible ? props.pending : null;
    return props.empty;
  }),
});

/** Presentation only: resource owners choose identity, loading, caching and cancellation. */
export const AsyncContent = implementation as unknown as JSX.ComponentType & {
  <A, E>(this: never, props: AsyncContentProps<A, E>): JSX.Element;
  readonly build: View<Props, never>['build'];
};
