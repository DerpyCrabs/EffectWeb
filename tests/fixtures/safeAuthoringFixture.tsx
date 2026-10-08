import { Cause, Context, Effect, Schema } from 'effect';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import { modelOwner, program, view, type Transition } from 'effectweb';
import { queryCache, query } from '@effectweb/query';

// The decoder determines the response type. HTTP and decoding failures stay typed.
const Item = Schema.Struct({ id: Schema.String, title: Schema.String });
export const fetchItems = (account: string) =>
  HttpClient.execute(
    HttpClientRequest.get(`/api/accounts/${encodeURIComponent(account)}/items`),
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Item))),
  );

class Storage extends Context.Service<
  Storage,
  {
    read: (account: string, filter: { status: string }) => Effect.Effect<string[]>;
    save: (text: string) => Effect.Effect<void>;
  }
>()('recipe/Storage') {}

// Every nested request argument is part of identity; services come from Context.
export const items = query({
  name: 'items',
  load: (args: { account: string; filter: { status: string } }) =>
    Effect.flatMap(Storage, (storage) => storage.read(args.account, args.filter)),
});

const saveSlot = 'save-draft';
type Model = { draft: string; saved: boolean; error: string };
type Message =
  | { type: 'Edit'; draft: string }
  | { type: 'Save' }
  | { type: 'Failed'; error: string }
  | { type: 'Saved' };
const update = (model: Model, message: Message): Transition<Model, Message, Storage> => {
  switch (message.type) {
    case 'Edit':
      return { model: { ...model, draft: message.draft, saved: false, error: '' } };
    case 'Save':
      return {
        model,
        commands: [
          {
            key: saveSlot,
            policy: 'queue',
            effect: Effect.flatMap(Storage, (storage) => storage.save(model.draft)).pipe(
              Effect.matchCause({
                onSuccess: (): Message => ({ type: 'Saved' }),
                onFailure: (cause): Message => ({
                  type: 'Failed',
                  error: String(Cause.squash(cause)),
                }),
              }),
            ),
          },
        ],
      };
    case 'Failed':
      return { model: { ...model, error: message.error } };
    case 'Saved':
      return { model: { ...model, saved: true, error: '' } };
  }
};
export const Editor = view<Model, Message>((model, send) => {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'Save' });
      }}
    >
      <input
        aria-label="Draft"
        value={model.draft}
        onInput={(event) => send({ type: 'Edit', draft: event.currentTarget.value })}
      />
      <button type="submit">Save</button>
      <span>{model.saved ? 'Saved' : 'Unsaved'}</span>
      <span role="alert">{model.error}</span>
    </form>
  );
});

export function createEditor(storage: Context.Service.Shape<typeof Storage>) {
  const context = Context.make(Storage, storage);
  const editor = program<Model, Message, Storage>({
    context,
    initial: { draft: '', saved: false, error: '' },
    update,
  });
  const owner = modelOwner<{ filter: string; result: string[] }>({ filter: '', result: [] });
  const fields = { filter: (value: string) => owner.patch({ filter: value }) };
  const cache = owner.own(queryCache(context));
  return {
    program: editor,
    fields,
    cache,
    dispose: () => {
      editor.dispose();
      owner.dispose();
    },
  };
}
