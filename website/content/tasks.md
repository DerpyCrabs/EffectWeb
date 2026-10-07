Run async work through a component or controller under a **key** when you need a concurrency policy or visible task status. Disposing the owner interrupts its work. For a simple action, an event handler can also return an Effect directly.

A key runs one piece of work at a time, unless its policy says otherwise. The **policy** decides what happens when new work arrives while the key is busy.

## Policies

| Policy          | When new work arrives while busy                          | Use it for                  |
| --------------- | --------------------------------------------------------- | --------------------------- |
| `replace`       | Cancel the running work and start the new one             | Search, debounce, selection |
| `drop`          | Ignore the new work                                       | Submit buttons, uploads     |
| `queue`         | Run it after the current one; keep every request in order | Writes that must all happen |
| `latest-queued` | Run it after the current one; keep only the newest        | Autosave                    |
| `parallel`      | Run it alongside                                          | Independent jobs            |

`owner.run`, in a controller or a component owner factory, accepts all five. [`owner.task`](#show-the-status-of-work) publishes one result, so it accepts all except `parallel`.

## Run an Effect from an event

An event handler can return an Effect. It runs on every event, until it finishes or the element is removed:

```tsx check
import { Effect } from 'effect';
import { view } from 'effectweb';

declare const clipboard: { copy: (text: string) => Effect.Effect<void, Error> }; // @hide

export const CopyButton = view<{ readonly text: string }>((props) => (
  <button onClick={() => clipboard.copy(props.text)}>Copy</button>
));
```

Event handlers have no policy. To ignore double clicks, replace earlier work or run clicks in order, run the Effect through an owner: `owner.run(key, effect, 'drop')` in a component, or a controller method.

## Run work in a key

`owner.run(key, effect, policy)` starts work in a key. A [controller](/docs/controllers/) calls it on its `modelOwner`; a [component](/docs/components/#running-effects) receives its owner through `owner => view(…)`. When the view shows the work's progress, use [`owner.task`](#show-the-status-of-work) instead.

Keys are strings, numbers or readonly arrays of them, compared structurally within one owner or program: two separately created arrays `['quote', 42]` address the same work, while `42`, `'42'` and `[42]` are different keys.

## Search as you type

Put the delay inside the Effect. When the next keystroke replaces the work, the delay is cancelled too, so this is also the debounce.

```ts check
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';

type Result = { readonly id: string; readonly title: string };
declare const search: (text: string) => Effect.Effect<readonly Result[], Error>; // @hide

const searchKey = 'search';

export function searchController() {
  const owner = modelOwner<{ text: string; results: readonly Result[]; error: string }>({
    text: '',
    results: [],
    error: '',
  });

  const change = (text: string) => {
    owner.patch({ text, error: '' });
    owner.run(
      searchKey,
      Effect.sleep(250).pipe(
        Effect.andThen(search(text)),
        Effect.tap((results) => Effect.sync(() => owner.patch({ results }))),
        Effect.catch((error) => Effect.sync(() => owner.patch({ error: error.message }))),
      ),
      'replace',
    );
  };

  return { source: owner.source, change, lifetime: owner };
}
```

## Show the status of work

`owner.task(field, effect, policy)` is `run` plus status. It runs the Effect under the key `field` and writes its `AsyncResult` into `model[field]`: waiting while work for the key runs or is queued, then the value, or the failure with the previous value kept. A run that was replaced never overwrites the newer run's state. You do not need `busy` and `error` fields.

```ts check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner } from 'effectweb';

declare const documents: { save: (text: string) => Effect.Effect<number, Error> }; // @hide

const owner = modelOwner<{ text: string; saved: AsyncResult.AsyncResult<number, Error> }>({
  text: '',
  saved: AsyncResult.initial(),
});
export const save = (text: string) => owner.task('saved', documents.save(text), 'drop');
```

`AsyncResult` comes from `effect/reactivity` (`import * as AsyncResult from 'effect/reactivity/AsyncResult'`), not from `effect`. Give the owner its model type, as above, so the field is declared as `AsyncResult.AsyncResult<A, E>`; without it the field is inferred from `AsyncResult.initial()` alone, which is narrower, and later results do not fit. In the view, read `model.saved.waiting`, `resourceError(model.saved)` and `available(model.saved)`.

A failed `AsyncResult` holds an Effect `Cause`, not your error, and in Effect 4 a `Cause` has no `_tag`. Do not inspect it by hand:

| To show                   | Write                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Whether it failed         | `AsyncResult.isFailure(model.saved)`                                                 |
| The error's message       | `resourceError(model.saved)`: a string, or `undefined` when it has not failed        |
| The error value itself    | `Cause.squash(model.saved.cause)` after checking `isFailure` (`Cause` from `effect`) |
| Whether work is running   | `model.saved.waiting`                                                                |
| The last successful value | `available(model.saved)`, kept while a retry runs                                    |

To clear the previous result before a new run, patch the field first, then start the task.

A task's field holds the status of an operation: whether it is running, its last value and its error. It is not a place to keep data you then change. If the user edits, reorders or deletes what was loaded, keep that data in its own field, written when the load succeeds, and use the task field only for waiting and errors. Otherwise a delete removes the item from your copy while the task still holds the old response, and the item comes back.

```ts check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner } from 'effectweb';

type Issue = { readonly id: string; readonly title: string };
declare const api: {
  search: (text: string) => Effect.Effect<readonly Issue[], Error>;
  remove: (id: string) => Effect.Effect<void, Error>;
}; // @hide

const owner = modelOwner<{
  issues: readonly Issue[];
  searching: AsyncResult.AsyncResult<readonly Issue[], Error>;
}>({ issues: [], searching: AsyncResult.initial() });

export const search = (text: string) =>
  owner.task(
    'searching',
    api.search(text).pipe(Effect.tap((issues) => Effect.sync(() => owner.patch({ issues })))),
    'replace',
  );

export const remove = (id: string) => {
  owner.edit('issues', (issues) => issues.filter((issue) => issue.id !== id));
  owner.run(['remove', id], api.remove(id), 'queue');
};
```

The view lists `model.issues` and shows `model.searching.waiting` and `resourceError(model.searching)`.

A failure that `task` publishes is not also reported to the console, since the view shows it. Defects are still reported.

## Run at most N at once

A policy decides what happens within one key. To limit work across keys, such as two uploads at a time, wrap each run's Effect in a permit of an Effect `Semaphore`. Work beyond the limit waits for a permit inside its own run, so `cancel(key)` still removes it, and `task` shows it as waiting.

```ts check
import { Effect, Semaphore } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner } from 'effectweb';

declare const upload: (file: File) => Effect.Effect<string, Error>; // @hide

const owner = modelOwner({
  uploads: {} as Partial<Record<string, AsyncResult.AsyncResult<string, Error>>>,
});
const slots = Semaphore.makeUnsafe(2);

export const start = (id: string, file: File) =>
  owner.task(['uploads', id], slots.withPermit(upload(file)), 'replace');
export const cancel = (id: string) => owner.cancel(['uploads', id]);
```

Waiting runs take permits in the order they asked for them.

## One key per row

A composite key addresses separate work for each row. Editing row A then never cancels row B's request.

```ts
owner.run(['quote', row.id], prices.quote(row.id, amount), 'replace');
```

With `task`, a key `[field, id]` writes `model[field][id]`. Declare the field as `Partial<Record<string, AsyncResult.AsyncResult<A, E>>>` and start it as `{}`, so a row that never ran reads as `undefined`:

```tsx check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner, resourceError, view, type Snapshot } from 'effectweb';

type Issue = { readonly id: string; readonly title: string };
declare const api: { save: (issue: Issue) => Effect.Effect<Issue, Error> }; // @hide

type Saving = Partial<Record<string, AsyncResult.AsyncResult<Issue, Error>>>;

const owner = modelOwner({ saving: {} as Saving });
export const save = (issue: Issue) => owner.task(['saving', issue.id], api.save(issue), 'drop');

export const SaveButton = view<{ readonly issue: Issue; readonly saving: Snapshot<Saving> }>(
  (props) => {
    const status = props.saving[props.issue.id]; // undefined until this row first saves
    return (
      <span>
        <button disabled={status?.waiting} onClick={() => save(props.issue)}>
          Save
        </button>
        {status && resourceError(status) ? <span role="alert">Save failed</span> : null}
      </span>
    );
  },
);
```

If the type error says `Declare per-row results as Partial<Record<Id, AsyncResult.AsyncResult<Value, Error>>>`, the field is declared without `Partial` (so TypeScript believes every row already has a result) or holds something other than `AsyncResult`s.

## Cancellation is not rollback

Interrupting a request stops your code from waiting for it. The server may still have received and applied it. For writes, prefer `queue` or `latest-queued`, which let the current write finish.

Interrupted work still runs its finalizers, and under `replace` they run after the newer work has started. Do not patch the model from `Effect.ensuring` there (EW1005). Use `owner.task`, which ignores runs that were replaced, or reset a flag with `Effect.tap` and `Effect.tapCause`, which run on success and failure but not when the run is interrupted.

## Call a Promise API

Wrap it with `Effect.tryPromise`, and pass the `signal` to APIs that accept one so the request is aborted on interruption:

```ts check
import { Effect } from 'effect';

export const loadText = (url: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
```

A Promise API without abort support keeps running after the Effect stops waiting.

## Wait for work to finish

- `owner.awaitIdle()` waits for the owner's work to settle without stopping it. `awaitIdle(key)` waits for one key.
- `dispose()` starts teardown and returns immediately.
- `close()` is an Effect that waits until teardown, including async finalizers, has finished. Use it in tests and in parent scopes that must wait.

`owner.run` and `owner.task` start the work immediately and return a handle. The handle is not an Effect, because the work is already running, so you can ignore it. To wait for that particular run, yield `run.await`: it gives the run's `Exit`, as `Fiber.await` does, once the work and its finalizers are done. Interrupting an observer does not cancel the work. To run one step after another, yield the first run's `Exit` and check it is a success.

```ts check
import { Effect, Exit } from 'effect';
import { modelOwner } from 'effectweb';

const owner = modelOwner({ saved: false });
const run = owner.run('save', Effect.succeed(42), 'queue'); // starts now
export const afterSave = Effect.gen(function* () {
  const exit = yield* run.await; // observes this run, without starting it again
  if (Exit.isSuccess(exit)) {
    owner.patch({ saved: true });
    return exit.value;
  }
  return undefined;
});
```

| How the run ends                                                          | `Exit`                   |
| ------------------------------------------------------------------------- | ------------------------ |
| Work completes                                                            | success with its value   |
| Work or a finalizer fails                                                 | failure with its `cause` |
| `cancel(key)`, `replace`, `latest-queued`, `drop`, or the owner is closed | interruption             |

Like `FiberMap.run` with `onlyIfMissing`, a dropped or discarded request is an interruption. A failure during finalization is a failure even when interruption triggered it.
