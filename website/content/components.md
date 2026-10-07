A component is a view with its own state. Each place you render it gets a separate copy of that state, and the state is dropped when the component leaves the page.

`component(definition, view)` takes the definition first and the view second. Start with local fields and move on only when you need to.

| Definition                     | Use it for                                                          |
| ------------------------------ | ------------------------------------------------------------------- |
| `{ init }`                     | Local fields: open/closed, a draft, the selected tab                |
| `{ init }`, `owner => view(…)` | Local fields plus Effects such as save or search, with their status |
| `{ init, update }`             | Logic written as named messages that you want to test as data       |

State shared by several views belongs in a [controller](/docs/controllers/) instead.

## Local fields

```tsx check
import { component, view } from 'effectweb';

export const Disclosure = component<{ readonly title: string }, { open: boolean }>(
  { init: () => ({ open: false }) },
  view((local, patch) => (
    <section>
      <button aria-expanded={local.open} onClick={() => patch({ open: !local.open })}>
        {local.props.title}
      </button>
      {local.open ? <p>Details</p> : null}
    </section>
  )),
);
```

- `init` returns the starting fields.
- `patch` takes the fields to change. It does not take an updater function.
- The parent's props are available as `local.props`.

The type arguments are the props and the fields. You can leave them out if you type the props on `init` instead: `init: (props: Snapshot<Props>) => …`.

To reset the state when the component starts showing a different entity, add `identity: (props) => props.id`.

## Running Effects

When the component needs to save, load or search, pass `owner => view(…)` as the second argument to receive the component's owner once per placement. Start work through that owner in an event handler. It has the same `run` and `task` methods as a [controller's owner](/docs/tasks/#run-work-in-a-key), and its work stops when the component goes away. `task` publishes the status (waiting, done, failed) in a field.

```tsx check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { component, view, type Snapshot } from 'effectweb';

declare const api: { rename: (id: string, title: string) => Effect.Effect<void, Error> }; // @hide

type RenameProps = { readonly id: string; readonly title: string };
type RenameState = { readonly draft: string; readonly saved: AsyncResult.AsyncResult<void, Error> };

export const RenameForm = component(
  {
    init: (props: Snapshot<RenameProps>): RenameState => ({
      draft: props.title,
      saved: AsyncResult.initial(),
    }),
    identity: (props) => props.id,
  },
  (owner) =>
    view((model) => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          return owner.task('saved', api.rename(model.props.id, model.draft), 'drop');
        }}
      >
        <input
          value={model.draft}
          onInput={(event) => owner.patch({ draft: event.currentTarget.value })}
        />
        <button disabled={model.saved.waiting}>Save</button>
        {AsyncResult.isFailure(model.saved) ? <p role="alert">Rename failed</p> : null}
      </form>
    )),
);
```

The handler builds the Effect from the current model, including `model.props`, so it can call a callback from the parent when the save finishes, for example with `Effect.tap(() => Effect.sync(() => model.props.onSaved()))`. The factory captures the owner, while the view reads current props from the model. Start work in handlers; starting work while the view renders is a lint error.

## Named messages

With `update`, every change is a message, and `update` returns the next model plus any work to start. This keeps the logic in one pure function you can test without a DOM. As with local fields, `init` returns the component's own state and the runtime adds the props as `model.props`.

```tsx check
import { Effect } from 'effect';
import { component, list, view, type Transition } from 'effectweb';

declare const api: { search: (text: string) => Effect.Effect<readonly string[], Error> }; // @hide
type SearchProps = { readonly placeholder: string };
type SearchState = { readonly text: string; readonly results: readonly string[] };
// What update and the view see: the state plus the props the runtime adds.
type SearchModel = SearchState & { readonly props: SearchProps };
type SearchMessage =
  | { type: 'Input'; text: string }
  | { type: 'Found'; results: readonly string[] }
  | { type: 'Failed' };

const searchKey = 'search';

export const Search = component<SearchProps, SearchState, SearchMessage>(
  {
    init: () => ({ text: '', results: [] }),
    update: (model, message): Transition<SearchModel, SearchMessage> => {
      switch (message.type) {
        case 'Input':
          return {
            model: { ...model, text: message.text },
            commands: [
              {
                key: searchKey,
                policy: 'replace',
                effect: Effect.sleep(250).pipe(
                  Effect.andThen(api.search(message.text)),
                  Effect.matchCause({
                    onSuccess: (results): SearchMessage => ({ type: 'Found', results }),
                    onFailure: (): SearchMessage => ({ type: 'Failed' }),
                  }),
                ),
              },
            ],
          };
        case 'Found':
          return { model: { ...model, results: message.results } };
        case 'Failed':
          return { model: { ...model, results: [] } };
      }
    },
  },
  view((model, send) => (
    <div>
      <input
        placeholder={model.props.placeholder}
        value={model.text}
        onInput={(event) => send({ type: 'Input', text: event.currentTarget.value })}
      />
      <ul>
        {list(model.results, (result) => (
          <li>{result}</li>
        ))}
      </ul>
    </div>
  )),
);
```

Each keystroke starts a search in `searchKey`. Because the policy is `replace`, a new keystroke cancels the previous search, including its 250 ms delay.

A command is `{ key, policy, effect }`, and the Effect's success is the next message. `Effect.matchCause` turns every outcome into a message; `Effect.match` handles typed failures and leaves defects to be reported. The error channel must be `never`, so a failure you forgot to handle is a type error. An Effect that succeeds with nothing sends no message. When a helper builds a command, give it the return type `Command<Message>`, or `policy` widens to `string`.

`update` must not run Effects, call prop callbacks or write to the model itself (EW1004); return a copied model and return the work as commands. To notify the parent, return `{ key, policy: 'queue', effect: Effect.sync(() => model.props.onChange(value)) }`. To react when props change, add `receive(model, previous)` to the definition: it runs with the new props already in `model.props` and the old ones in `previous`, and returns a transition like `update`.

The same `update` also works outside a component: `program({ initial, update })` runs it for a whole app, and returns a source to `makeMount` and a `send` for messages that come from outside, such as server events. A child view that reports to the component takes `send` as a prop; see [Telling the parent something happened](/docs/views/#telling-the-parent-something-happened).
