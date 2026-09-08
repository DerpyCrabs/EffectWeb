import { Cause, Context, Effect, Schema } from 'effect';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import {
  commandSlot,
  defineActions,
  effectCommand,
  httpJson,
  makeQueryCache,
  modelOwner,
  query,
  uiRuntime,
  view,
  type ActionMessage,
} from 'effectweb';

// The decoder determines the response type. HTTP and decoding failures stay typed.
const Item = Schema.Struct({ id: Schema.String, title: Schema.String });
export const fetchItems = (account: string) =>
  httpJson(
    HttpClientRequest.get(`/api/accounts/${encodeURIComponent(account)}/items`),
    Schema.Array(Item),
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

const saveSlot = commandSlot('save-draft');
type Model = { draft: string; saved: boolean; error: string };
const actions = defineActions<Model, Storage>()({
  Edit: (model, draft: string) => ({ model: { ...model, draft, saved: false, error: '' } }),
  Save: (model) => ({
    model,
    commands: [
      effectCommand(
        saveSlot,
        () => Effect.flatMap(Storage, (storage) => storage.save(model.draft)),
        {
          policy: 'queue',
          onSuccess: () => ({ type: 'Saved' as const, args: [] satisfies [] }),
          onFailure: (cause) => ({
            type: 'Failed' as const,
            args: [String(Cause.squash(cause))] satisfies [string],
          }),
        },
      ),
    ],
  }),
  Failed: (model, error: string) => ({ model: { ...model, error } }),
  Saved: (model) => ({ model: { ...model, saved: true, error: '' } }),
});
export const Editor = view<Model, ActionMessage<typeof actions>>((model, send) => {
  const dispatch = actions.bind(send);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        dispatch.Save();
      }}
    >
      <input
        aria-label="Draft"
        value={model.draft}
        onInput={(event) => dispatch.Edit(event.currentTarget.value)}
      />
      <button type="submit">Save</button>
      <span>{model.saved ? 'Saved' : 'Unsaved'}</span>
      <span role="alert">{model.error}</span>
    </form>
  );
});

export function createEditor(storage: Context.Service.Shape<typeof Storage>) {
  const runtime = uiRuntime(Context.make(Storage, storage));
  const program = runtime.program<Model, ActionMessage<typeof actions>>({
    initial: { draft: '', saved: false, error: '' },
    update: actions.update,
  });
  const owner = modelOwner<{ filter: string; result: string[] }>({ filter: '', result: [] });
  const fields = owner.fields('filter');
  const cache = owner.own(makeQueryCache(runtime));
  return {
    program,
    fields,
    cache,
    dispose: () => {
      program.dispose();
      owner.dispose();
    },
  };
}
