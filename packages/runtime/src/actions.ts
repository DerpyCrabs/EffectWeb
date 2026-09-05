import type { Send, Transition } from './program.js';

type Handler<Model> = (model: Model, ...args: never[]) => Transition<Model, unknown>;
type Arguments<F> = F extends (model: never, ...args: infer Args) => unknown ? Args : never;
type HandlerMessage<Handlers> = {
  [Name in keyof Handlers]: { readonly type: Name; readonly args: Arguments<Handlers[Name]> };
}[keyof Handlers];
export type ActionMessage<Definition> = Definition extends {
  update: (model: never, message: infer Message) => unknown;
}
  ? Message
  : never;
type Creators<Handlers> = {
  [Name in keyof Handlers]: (
    ...args: Arguments<Handlers[Name]>
  ) => Extract<HandlerMessage<Handlers>, { type: Name }>;
};
type Dispatch<Handlers> = {
  [Name in keyof Handlers]: (...args: Arguments<Handlers[Name]>) => void;
};

/** Declare action names and payloads once. Dispatch still crosses the ordinary program message queue. */
export function defineActions<Model>() {
  return <Handlers extends Record<string, Handler<Model>>>(handlers: Handlers) => {
    type Message = HandlerMessage<Handlers>;
    const message = Object.create(null) as Creators<Handlers>;
    for (const name of Object.keys(handlers) as (keyof Handlers)[]) {
      Object.defineProperty(message, name, {
        enumerable: true,
        value: (...args: unknown[]) => ({ type: name, args }),
      });
    }
    return {
      message,
      bind(this: void, send: Send<Message>): Dispatch<Handlers> {
        const dispatch = Object.create(null) as Dispatch<Handlers>;
        for (const name of Object.keys(handlers) as (keyof Handlers)[]) {
          Object.defineProperty(dispatch, name, {
            enumerable: true,
            value: (...args: unknown[]) => send({ type: name, args } as Message),
          });
        }
        return dispatch;
      },
      update(this: void, model: Model, action: Message): ReturnType<Handlers[keyof Handlers]> {
        if (!Object.hasOwn(handlers, action.type))
          throw new Error(`Unknown action: ${String(action.type)}`);
        const handler = handlers[action.type] as (
          model: Model,
          ...args: unknown[]
        ) => ReturnType<Handlers[keyof Handlers]>;
        return handler(model, ...action.args);
      },
    };
  };
}
