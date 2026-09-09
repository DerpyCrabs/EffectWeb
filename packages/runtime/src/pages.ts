import { commandSlot } from './program.js';
import type { Snapshot } from './snapshot.js';
import { shareData } from './sharing.js';
import { Cause, Option } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import type { UiLoad, UiPage } from './load.js';
import {
  effectCommand,
  program,
  type Transition,
  type Send,
  type RunningProgram,
} from './program.js';
import { defaultUiRuntime, type UiRuntime } from './runtime.js';
import { available } from './resource.js';

export interface PagesModel<Props, A, Cursor, E = unknown> {
  readonly props: Props;
  readonly key: string | undefined;
  readonly result: AsyncResult.AsyncResult<UiPage<A, Cursor>, E>;
  readonly append: boolean;
}
export type PagesRequest = { type: 'More' } | { type: 'Retry' } | { type: 'Refresh' };
/** Low-level reducer protocol, including completions for explicit program composition. */
export type PagesMessage<A, Cursor, E = unknown> =
  | PagesRequest
  | { type: 'Loaded'; page: UiPage<A, Cursor>; append: boolean }
  | { type: 'Failed'; cause: Cause.Cause<E> };
/** An owned pagination source with immutable input updates. */
export interface PagesProgram<Props, A, Cursor, E = unknown> extends RunningProgram<
  PagesModel<Props, A, Cursor, E>,
  PagesRequest
> {
  readonly receive: (props: Props | Snapshot<Props>) => void;
}

/** Reusable pagination transitions, or an independently owned source through create. */
export interface Pagination<Props, A, Cursor, E = unknown> {
  readonly init: (
    props: Props | Snapshot<Props>,
  ) => PagesModel<Props, A, Cursor, E> | Snapshot<PagesModel<Props, A, Cursor, E>>;
  readonly receive: (
    model: PagesModel<Props, A, Cursor, E> | Snapshot<PagesModel<Props, A, Cursor, E>>,
    props: Props | Snapshot<Props>,
    options?: { refresh?: boolean },
  ) => Transition<PagesModel<Props, A, Cursor, E>, PagesMessage<A, Cursor, E>>;
  readonly update: (
    model: PagesModel<Props, A, Cursor, E> | Snapshot<PagesModel<Props, A, Cursor, E>>,
    message: PagesMessage<A, Cursor, E>,
  ) => Transition<PagesModel<Props, A, Cursor, E>, PagesMessage<A, Cursor, E>>;
  readonly create: (props: Props | Snapshot<Props>) => PagesProgram<Props, A, Cursor, E>;
}

/**
 * Pagination owns the `page` command slot. Key changes clear results and replace the request;
 * same-key refreshes keep the last success, and retries repeat the failed cursor.
 * Feed request inputs through receive; pass { refresh: true } for explicit same-key submissions.
 */
export function pages<Props, A, Cursor, E = unknown, R = never>(
  definition: {
    key: (props: Snapshot<Props>) => string | undefined;
    load: (
      props: Snapshot<Props>,
      cursor: Snapshot<Cursor> | undefined,
    ) => UiLoad<UiPage<A, Cursor>, E, R>;
    itemKey: (item: Snapshot<A>) => string;
  },
  ...provided: [R] extends [never] ? [runtime?: UiRuntime<R>] : [runtime: UiRuntime<R>]
): Pagination<Props, A, Cursor, E> {
  const runtime = provided[0] ?? (defaultUiRuntime as UiRuntime<R>);
  const commandPage = commandSlot('page');
  type Model = PagesModel<Props, A, Cursor, E>;
  type Message = PagesMessage<A, Cursor, E>;
  const request = (model: Model, append: boolean): Transition<Model, Message> => {
    const previous = available(model.result);
    if (append && (model.result.waiting || !previous || previous.next === undefined))
      return { model };
    if (model.key === undefined) return { model };
    const cursor = append ? previous?.next : undefined;
    return {
      model: { ...model, append, result: AsyncResult.waiting(model.result) },
      commands: [
        runtime.command(
          effectCommand(
            commandPage,
            () =>
              definition.load(
                model.props as Snapshot<Props>,
                cursor as Snapshot<Cursor> | undefined,
              ),
            {
              policy: 'replace',
              onSuccess: (page): Message => ({ type: 'Loaded', page, append }),
              onFailure: (cause): Message => ({ type: 'Failed', cause }),
            },
          ),
        ),
      ],
    };
  };
  const pagination = {
    init: (props: Props | Snapshot<Props>): Model | Snapshot<Model> => ({
      props: props as Props,
      key: undefined,
      result: AsyncResult.initial<UiPage<A, Cursor>, E>(),
      append: false,
    }),
    receive(
      snapshot: Model | Snapshot<Model>,
      input: Props | Snapshot<Props>,
      options: { refresh?: boolean } = {},
    ): Transition<Model, Message> {
      const model = snapshot as Model;
      const props = input as Props;
      const key = definition.key(props as Snapshot<Props>);
      if (key === model.key) {
        const shared = shareData(model.props, props);
        const next = shared === model.props ? model : { ...model, props: shared };
        return options.refresh ? request(next, false) : { model: next };
      }
      const next = {
        ...model,
        props,
        key,
        append: false,
        result: AsyncResult.initial<UiPage<A, Cursor>, E>(),
      };
      return key === undefined ? { model: next, cancel: [commandPage] } : request(next, false);
    },
    update(snapshot: Model | Snapshot<Model>, message: Message): Transition<Model, Message> {
      const model = snapshot as Model;
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
          const known = new Set(
            previous?.items.map((item) => definition.itemKey(item as Snapshot<A>)),
          );
          const incoming = message.page.items.filter((item) => {
            const key = definition.itemKey(item as Snapshot<A>);
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
    create(props: Props | Snapshot<Props>) {
      type Internal = Message | { type: 'Input'; props: Props | Snapshot<Props> };
      const source = program<Model, Internal>({
        initial: pagination.init(props),
        update: (model, message) =>
          message.type === 'Input'
            ? pagination.receive(model, message.props)
            : pagination.update(model, message),
      });
      const receive = (props: Props | Snapshot<Props>) => source.send({ type: 'Input', props });
      receive(props);
      return { ...source, send: source.send as Send<PagesRequest>, receive };
    },
  };
}
