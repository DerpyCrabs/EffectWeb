import { shareValue } from './share.js';
import { Cause, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import type { UiLoad, UiPage } from './load.js';
import { effectCommand, program, type Transition, type Send } from './program.js';
import { available } from './resource.js';
export interface PagesModel<Props, A, Cursor> {
  readonly props: Props;
  readonly key: string | undefined;
  readonly result: AsyncResult.AsyncResult<UiPage<A, Cursor>, unknown>;
  readonly append: boolean;
}
export type PagesMessage<A, Cursor> =
  | { type: 'More' }
  | { type: 'Retry' }
  | { type: 'Refresh' }
  | { type: 'Loaded'; page: UiPage<A, Cursor>; append: boolean }
  | { type: 'Failed'; cause: Cause.Cause<unknown> };
/**
 * Pagination owns the `page` command slot. Key changes clear results and replace the request;
 * same-key refreshes keep the last success, and retries repeat the failed cursor.
 * Feed request inputs through receive; pass { refresh: true } for explicit same-key submissions.
 */
export function pages<Props, A, Cursor>(definition: {
  key: (props: Props) => string | undefined;
  load: (props: Props, cursor: Cursor | undefined) => UiLoad<UiPage<A, Cursor>>;
  itemKey: (item: A) => string;
}) {
  type Model = PagesModel<Props, A, Cursor>;
  type Message = PagesMessage<A, Cursor>;
  const request = (model: Model, append: boolean): Transition<Model, Message> => {
    const previous = available(model.result);
    if (append && (model.result.waiting || !previous || previous.next === undefined))
      return { model };
    if (model.key === undefined) return { model };
    const cursor = append ? previous?.next : undefined;
    return {
      model: { ...model, append, result: AsyncResult.waiting(model.result) },
      commands: [
        effectCommand('page', () => definition.load(model.props, cursor), {
          onSuccess: (page): Message => ({ type: 'Loaded', page, append }),
          onFailure: (cause): Message => ({ type: 'Failed', cause }),
        }),
      ],
    };
  };
  const pagination = {
    init: (props: Props): Model => ({
      props,
      key: undefined,
      result: AsyncResult.initial(),
      append: false,
    }),
    receive(
      model: Model,
      props: Props,
      options: { refresh?: boolean } = {},
    ): Transition<Model, Message> {
      const key = definition.key(props);
      if (key === model.key) {
        const shared = shareValue(model.props, props);
        const next = shared === model.props ? model : { ...model, props: shared };
        return options.refresh ? request(next, false) : { model: next };
      }
      const next = {
        ...model,
        props,
        key,
        append: false,
        result: AsyncResult.initial<UiPage<A, Cursor>, unknown>(),
      };
      return key === undefined ? { model: next, cancel: ['page'] } : request(next, false);
    },
    update(model: Model, message: Message): Transition<Model, Message> {
      switch (message.type) {
        case 'More':
          return request(model, true);
        case 'Retry':
          return request(model, model.append);
        case 'Refresh':
          return request(model, false);
        case 'Failed':
          return {
            model: {
              ...model,
              result: AsyncResult.failureWithPrevious(message.cause, {
                previous: Option.some(model.result),
              }),
            },
          };
        case 'Loaded': {
          const previous = message.append ? available(model.result) : undefined;
          const known = new Set(previous?.items.map(definition.itemKey));
          const incoming = message.page.items.filter((item) => {
            const key = definition.itemKey(item);
            if (known.has(key)) return false;
            known.add(key);
            return true;
          });
          const page = {
            ...message.page,
            items: previous ? [...previous.items, ...incoming] : incoming,
          };
          return { model: { ...model, result: AsyncResult.success(page) } };
        }
      }
    },
  };
  return {
    ...pagination,
    create(props: Props) {
      type Internal = Message | { type: 'Input'; props: Props };
      const source = program<Model, Internal>({
        initial: pagination.init(props),
        update: (model, message) =>
          message.type === 'Input'
            ? pagination.receive(model as Model, message.props)
            : pagination.update(model as Model, message),
      });
      const receive = (props: Props) => source.send({ type: 'Input', props });
      receive(props);
      return { ...source, send: source.send as Send<Message>, receive };
    },
  };
}
