A controller holds the state and actions for a feature, such as a document editor or a chat. Use one when several views share state, or when the logic is big enough that you want it outside the view.

A controller is a plain function. It creates a `modelOwner`, which stores the state, and returns the methods views may call.

## Write a controller

```tsx check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner } from 'effectweb';

declare const documents: { save: (text: string) => Effect.Effect<number, Error> }; // @hide

export function documentController() {
  const owner = modelOwner<{ text: string; saved: AsyncResult.AsyncResult<number, Error> }>({
    text: '',
    saved: AsyncResult.initial(),
  });

  return {
    source: owner.source,
    edit: (text: string) => owner.patch({ text }),
    save: (text: string) => owner.task('saved', documents.save(text), 'drop'),
    lifetime: owner,
  };
}
```

- `owner.patch` publishes new fields. Views reading `owner.source` update.
- `owner.task('saved', effect, 'drop')` starts the save and publishes its [status](/docs/tasks/#show-the-status-of-work) into `model.saved`: waiting while it runs, then the value or the error. The [policy](/docs/tasks/#policies) `drop` ignores a second save while one is running. Use `owner.run` for work whose progress nothing shows.
- `lifetime: owner` identifies the resource that owns cleanup. A placement calls its `dispose()` on removal and waits for `close()` during awaited teardown. Outside a placement, close the lifetime when the feature ends.

In a view, read `model.saved.waiting` and `resourceError(model.saved)`.

## Create a controller from a view

For a top-level feature, pass the controller itself to [`mount`](/docs/services/): `mount(element, App, documentController())`. Its methods reach the view as `model.actions`, and `mount` leaves disposing it to you. For a controller that belongs to one place on the page, use `controllerView`. It takes the same object, creates it when the view appears, passes it new props, and disposes it when the view goes away.

```tsx check
import { controllerView, modelOwner, view, type Snapshot } from 'effectweb';

function chatController(props: Snapshot<{ readonly chatId: string }>) {
  const owner = modelOwner({ chatId: props.chatId, draft: '' });
  return {
    source: owner.source,
    edit: (draft: string) => owner.patch({ draft }),
    receive: (next: Snapshot<{ readonly chatId: string }>) => owner.patch({ chatId: next.chatId }),
    lifetime: owner,
  };
}

export const Chat = controllerView(
  { identity: (props) => props.chatId, controller: chatController },
  view((model) => (
    <input value={model.draft} onInput={(event) => model.actions.edit(event.currentTarget.value)} />
  )),
);
```

`identity` creates a fresh controller when `chatId` changes. `receive` is optional. `lifetime: owner` explicitly supplies both immediate disposal and awaited cleanup. Use `beforeDispose` for a controller-specific hook that runs before its lifetime is released. `lifetime` cannot be combined with controller `dispose` or `close` methods; that combination is rejected by the types and at runtime. To declare the view separately, type it with `ControllerModel<typeof chatController>`.

## The model owner

| Method                          | What it does                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `read()`                        | The current state.                                                                            |
| `patch(fields)`                 | Publish new values for some fields.                                                           |
| `edit(key, fn)`                 | Publish `fn(current)` for one field.                                                          |
| `transaction(fn)`               | Group several changes into one publication.                                                   |
| `run(key, effect, policy)`      | Start work and return a handle to that run. See [Async work](/docs/tasks/#run-work-in-a-key). |
| `task(field, effect, policy)`   | `run`, publishing the work's `AsyncResult` in `model[field]`.                                 |
| `cancel(key)`, `isRunning(key)` | Stop or inspect the work in a key.                                                            |
| `awaitIdle(key?)`               | An Effect that waits until work finishes.                                                     |
| `own(resource)`                 | Release a cache, subscription or cleanup function with the owner.                             |
| `dispose()`, `close()`          | Stop all work. `close()` is an Effect that waits for cleanup.                                 |

Inside an Effect scope, `Effect.acquireRelease(Effect.sync(() => modelOwner(initial)), (owner) => owner.close())` creates an owner that closes with the scope. `close()` never fails; cleanup errors go to the `onDefect` option.

A controller with no state of its own, such as one that combines other sources, uses `modelOwner({})` for its resources and work.
