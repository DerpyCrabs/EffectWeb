# Authoring EffectWeb applications

This is the guide to read before writing EffectWeb code, whether you are a person or a coding agent. It gives one recommended API for each job. Every snippet here is compiled in `src/authoring-guide.typecheck.tsx`.

## The model in three rules

1. **Views are pure functions of an immutable snapshot.** `view((model, send) => <jsx/>)` runs again on every publication. There are no hooks, no dependency arrays and no refs. Read everything from `model`; never read mutable module state, `Date.now()` or `Math.random()` while rendering.
2. **State changes happen outside rendering.** Event handlers `send` messages, `patch` local fields or call controller methods. Published objects and arrays are frozen, and `Snapshot<T>` is deeply readonly: copy (`{ ...row, done: true }`), never mutate.
3. **Effects are owned.** Every Effect runs in a named slot with a policy (`replace`, `drop`, `queue`, `latest-queued`, `parallel`). The owning component, controller or DOM listener interrupts it on disposal. You never write cleanup bookkeeping.

## Choose the API

| You need                                                 | Use                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Presentation of props                                    | `view<Props, Message>((model, send) => …)`                                            |
| Rows that can be added, removed, reordered or edited     | `list(entities(rows), render)`; `collection(identity)` when the key is not `id`       |
| Static or append-only values without state               | `list(sequence(values), render)` or a plain `.map` of text-only markup                |
| Local UI fields (open, draft text, tab)                  | `localComponent({ init, view })`                                                      |
| Local fields plus Effect work (save, search) with status | `defineTasks({ init }).tasks({ … }).view(…)`                                          |
| Transitions you want to name and test as messages        | `component({ init, update, view })` with `effectCommand`                              |
| A feature controller shared by several views             | `modelOwner(initial)` (or `makeModelOwner` inside an Effect scope)                    |
| One debounced/replaced request per row or entity         | `commandSlots('name')(rowId)` with `owner.run` / `effectCommand`                      |
| An Effect started directly by a click                    | `onClick={effectEvent('drop', () => effect)}` or return the Effect from the handler   |
| Cached server data                                       | `@effectweb/query`: `query(…)`, then `querySource` in views or `observeQuery`         |
| Loading/empty/failure presentation                       | `<AsyncContent result={…} content={…} pending={…} failure={…} />`                     |
| Imperative DOM (focus, charts, observers)                | `use={domMount(setup)}` or `use={domBinding(data, setup)}` with `setup` declared once |
| Rendering into another element                           | `<Portal mount={element}>…</Portal>`                                                  |
| Containing a render failure                              | `errorBoundary(view, { fallback })`                                                   |
| Simple controlled inputs                                 | `onInput={(event) => …event.currentTarget.value}`; `onSubmit={submit(() => …)}`       |
| Large validated forms                                    | `@effectweb/tanstack-form`                                                            |
| Routing and links                                        | `@effectweb/tanstack-router` with `createLink(router)`                                |
| Tests and browser fixtures                               | `renderView`, `programDriver`, `controlledEffect` from `effectweb/testing`            |

Import from `effectweb`; it covers ordinary applications. `effectweb/advanced` is for writing adapters (`projectionSource`, `shareValue`), explicit render optimizations (`memoView`, `listView`, `lazyView`) and a few composition utilities. Reach for it only when a root API has no equivalent, and prefer Effect's own APIs (`Effect.suspend`, `Scope`) to wrappers. `effectweb/testing` is for tests. Never import `effectweb/dom`, which is the compiler's output target.

## Views

```tsx
type Todo = { readonly id: string; readonly title: string; readonly done: boolean };
type TodoMessage = { type: 'Toggle'; id: string } | { type: 'Rename'; id: string; title: string };

export const TodoRow = view<Todo, TodoMessage>((todo, send) => (
  <li>
    <input
      type="checkbox"
      checked={todo.done}
      onChange={() => send({ type: 'Toggle', id: todo.id })}
    />
    <input
      value={todo.title}
      onInput={(event) => send({ type: 'Rename', id: todo.id, title: event.currentTarget.value })}
    />
  </li>
));
```

- A view without messages (`view<Props>`) and every component (`localComponent`, `component`, `defineTasks(…).view`) render as ordinary JSX: `<Disclosure title="More" />`.
- A view with messages needs its dispatcher: `<ViewBinding view={TodoRow} model={todo} send={send} />`.
- Helpers are plain functions; call them with values from `model`. Use `class`, not `className`. `key`, `ref` and `innerHTML` are rejected by the compiler (EW1001).
- Controlled inputs: bind `value`/`checked` from the model and update in `onInput`/`onChange`, reading the typed `event.currentTarget.value` (or `.checked`, or `.valueAsNumber`, which is `NaN` when empty). If a handler normalizes or rejects the edit, the control is restored to the model value.

## Lists and identity

`.map(...)` in JSX gives positional identity. If you remove or reorder a row, the next row inherits the removed row's component state, focus, input drafts and running work. Use `list` with a keyed collection whenever rows contain components, inputs or anything stateful:

```tsx
export const TodoList = view<{ readonly todos: readonly Todo[] }, TodoMessage>((model, send) => (
  <ul>
    {list(entities(model.todos), (todo) => (
      <ViewBinding view={TodoRow} model={todo} send={send} />
    ))}
  </ul>
));
```

- `entities(rows)` keys by `row.id`. Use `const byCode = collection<Row>((row) => row.code)` then `list(byCode.from(rows), render)` for other keys. Keys must be unique; duplicates throw.
- `list(plainArray, render)` keys by object reference, so editing a row (a new object) remounts it. Prefer `entities`.
- Do not build identity from an index, as in `` identity: (p) => `${type}-${index}` ``. Deleting a middle row gives its index to the next row.
- `.map` over a literal array (`['a', 'b'].map(…)`) or over rows rendering only text is fine.
- The `effectweb/identity` lint (EW3001) flags `.map` rows that contain components or form controls.

## Local state

```tsx
export const Disclosure = localComponent<{ readonly title: string }, { open: boolean }>({
  init: () => ({ open: false }),
  view: view((local, patch) => (
    <section>
      <button aria-expanded={local.open} onClick={() => patch({ open: !local.open })}>
        {local.props.title}
      </button>
      {local.open ? <p>Details</p> : null}
    </section>
  )),
});
```

Props arrive as `local.props`. `patch` takes a partial object, never an updater callback. Pass `identity: (props) => props.id` to reset local state when the entity changes.

### Local state with Effect work

When a component must run Effects, use `defineTasks`. Do not use a `component` whose model is only `{ props }` with placeholder `'applied'` messages.

```tsx
const renaming = defineTasks({
  init: (props: Snapshot<{ readonly id: string; readonly title: string }>) => ({
    draft: props.title,
  }),
  identity: (props) => props.id,
}).tasks({ save: { policy: 'drop', run: (model) => api.rename(model.props.id, model.draft) } });
export const RenameForm = renaming.view(
  view((model, send) => {
    const controls = renaming.controls(send);
    return (
      <form onSubmit={submit(() => controls.run('save'))}>
        <input
          value={model.draft}
          onInput={(event) => controls.patch({ draft: event.currentTarget.value })}
        />
        <button disabled={model.tasks.save.waiting}>Save</button>
        {AsyncResult.isFailure(model.tasks.save) ? <p role="alert">Rename failed</p> : null}
      </form>
    );
  }),
);
```

`model.tasks.<name>` is an `AsyncResult`. Its `waiting` flag and failure drive the UI. `run(model, input)` sees the current snapshot, including `model.props` callbacks, so results can be handed back with `Effect.tap(… model.props.onSaved …)`.

### Messages and commands

Use `component` when named messages make the logic clearer or testable:

```tsx
const searchSlot = commandSlot('search');
export const Search = component<SearchModel['props'], SearchModel, SearchMessage>({
  init: (props) => ({ props, text: '', results: [] }),
  update: (model, message): Transition<SearchModel, SearchMessage> => {
    switch (message.type) {
      case 'Input':
        return {
          model: { ...model, text: message.text },
          commands: [
            effectCommand(
              searchSlot,
              () => Effect.sleep(250).pipe(Effect.andThen(api.search(message.text))),
              {
                policy: 'replace',
                onSuccess: (results): SearchMessage => ({ type: 'Found', results }),
                onFailure: (): SearchMessage => ({ type: 'Failed' }),
              },
            ),
          ],
        };
      case 'Found':
        return { model: { ...model, results: message.results } };
      case 'Failed':
        return { model: { ...model, results: [] } };
    }
  },
  view: view((model, send) => /* … */ null),
});
```

`update` must be pure: return the next model plus commands, and never run Effects or call props callbacks inline. `replace` on a debounced slot gives you cancellation of stale searches for free. Use `receive(model, props)` to react to new props.

To hand a result to the parent, return `actionCommand(slot, () => Effect.sync(() => model.props.onChange(next)), 'queue')`. It runs after the update and needs no reply message; `queue` keeps every change, where `replace` could drop one that hasn't started yet. Don't wrap it in `effectCommand` with placeholder `'applied'` messages. Because `update` receives the latest props, results applied this way land on current data rather than on props captured when the request started.

## Controllers

`modelOwner` is a small store for a feature: `read()`, `patch()`, `edit(key, fn)`, `transaction(fn)` and `run(slot, effect, policy)`. Views receive `owner.source` through `mount`/`mountView` or as props.

```tsx
const loadSlot = commandSlot('load');
const priceSlot = commandSlots('price');

const changeAmount = (id: string, amount: number) => {
  owner.edit('rows', (rows) => rows.map((row) => (row.id === id ? { ...row, amount } : row)));
  // One debounced quote per row: editing row A never cancels row B's request.
  owner.run(
    priceSlot(id),
    Effect.sleep(300).pipe(
      Effect.andThen(prices.quote(id, amount)),
      Effect.tap((price) =>
        Effect.sync(() =>
          owner.edit('rows', (rows) =>
            rows.map((row) => (row.id === id && row.amount === amount ? { ...row, price } : row)),
          ),
        ),
      ),
      Effect.catch((error) => Effect.sync(() => owner.patch({ error: error.message }))),
    ),
    'replace',
  );
};
```

- Declare slots once, at module or controller scope. Calling `commandSlot('x')` inside a handler creates a new slot on every call, so `replace` and `drop` never apply and stale responses can overwrite newer ones (EW3003). Use `commandSlots(name)(key)` for per-row work.
- Policies: `replace` for search/debounce/latest-wins, `drop` for submit buttons (ignore double clicks), `queue` for writes that must all happen in order, `latest-queued` for autosave, `parallel` only for independent work.
- Interruption is not rollback: an interrupted save may already have reached the server. Serialize writes with `queue`/`latest-queued`.
- `owner.own(resource)` ties caches and subscriptions to the owner. Call `dispose()` (or yield `close()`) when the feature unmounts. `makeModelOwner` does this with the surrounding Effect scope.

### Effects from events

Event handlers may return an Effect. It runs owned by the element's listener and is interrupted when the element goes away. `effectEvent('drop' | 'replace', fn)` adds a concurrency policy:

```tsx
export const CopyButton = view<{ readonly text: string }>((model) => (
  <button onClick={effectEvent('drop', () => clipboard.copy(model.text))}>Copy</button>
));
```

## Server data

Server data lives in `@effectweb/query`. There is one kind of query: a cached `query` (or `infiniteQuery` for pages), read by views through `querySource` or by controllers through `observeQuery`.

```tsx
const userQuery = query({
  name: 'user',
  staleTime: 30_000,
  load: (args: { readonly id: string }) => users.get(args.id),
});
export function profileController(id: string) {
  const owner = modelOwner<{ user: AsyncResult.AsyncResult<Snapshot<User>, Error> }>({
    user: AsyncResult.initial(),
  });
  const cache = owner.own(makeQueryCache());
  const user = observeQuery(owner, cache, userQuery, (result) => owner.patch({ user: result }));
  user.select({ id });
  return { source: owner.source, refresh: user.refresh, dispose: owner.dispose };
}
// Views can read a query directly; equal arguments share one cached, live source.
declare const appCache: QueryCache;
export const UserName = view<{ readonly id: string }>((model) =>
  observe(querySource(appCache, userQuery, { id: model.id }), (user) => (
    <AsyncContent result={user} content={(value) => <b>{value.name}</b>} />
  )),
);
```

- Query identity is every argument. There is no custom `key`, so the wrong entry can't be reused (EW2002). Services come from the Effect environment, not arguments.
- Share one cache per application or session. Invalidate with `cache.invalidateQuery(query, args)` or `queryGroup`, and write with `setQueryData`/`updateQueryData`.
- Loaders get services from the cache's runtime (`makeQueryCache(uiRuntime(context))`), not from props or closures. `available(result)` and `resourceError(result)` read an `AsyncResult`.
- Paginate with `infiniteQuery`. Views read it with `querySource` and load more with `fetchNextPage(cache, query, args)` from an event handler; controllers can use `infiniteResource`.
- Present results with `AsyncContent` rather than hand-written `isInitial`/`isFailure` branches.
- Keep orchestration in Effect pipelines and publish command completion into immutable controller state. Start owned work with `owner.run`; compose or await `owner.awaitIdle()` inside Effect when synchronization is required. Promise conversion belongs only at external library or browser integration boundaries.
- Adapt Promise APIs explicitly with `Effect.tryPromise({ try: (signal) => fetch(url, { signal }), catch: (error) => error })`.
- Internal component and controller loaders return Effects, for example `(path: string) => Effect.Effect<Document, LoadError>`. The controller runs them through an owned command. Passing a callback is not render work; invoking it during render is. Promise-valued callbacks belong only to external interop contracts. Native DOM event handlers should return an Effect instead of an unowned Promise.
- A controller without a model of its own (a session composed from other sources) owns its resources and commands with `lifetime()` (`run`, `cancel`, `awaitIdle`, and `close` have the same ownership as `modelOwner`): `observeQuery(scope, cache, query, changed)`, `scope.add(unsubscribe)` and `scope.dispose()`.

## Time

Views never read the clock, because `Date.now()` or `new Date()` in render is stale until something else publishes (EW1003). Declare a clock source once and observe it; it only ticks while something is rendered from it:

```tsx
const minute = clock(60_000);
const ago = (iso: string, now: number) => `${Math.round((now - Date.parse(iso)) / 60_000)}m ago`;
export const Updated = view<{ readonly at: string }>((model) => (
  <time>{observe(minute, (now) => ago(model.at, now))}</time>
));
```

Controllers can merge it with `minute.subscribe((now) => owner.patch({ now }))`. Event handlers and commands may read the clock directly.

## DOM access

There are no refs. Attach behavior with `use`:

```tsx
const autofocus = domMount((element: HTMLInputElement) => element.focus());

// Declared once at module scope: the acquire function is the binding's identity.
const drawChart = (canvas: HTMLCanvasElement, points: () => Snapshot<readonly number[]>) => {
  const instance = chart.create(canvas);
  instance.draw(points());
  return { update: () => instance.draw(points()), dispose: instance.destroy };
};
export const Chart = view<{ readonly points: readonly number[] }>((model) => (
  <canvas use={domBinding(model.points, drawChart)} />
));
```

Setup may return nothing, a cleanup function, `{ update?, dispose }`, or an Effect finalized with the element. Never create the setup function inside a view (EW3002): it would be released and acquired again on every update. Window/document listeners belong in a `domMount` too, so they are removed with the element.

## Errors, mounting and services

- Wrap risky subtrees: `errorBoundary(Profile, { fallback: view(({ error }) => …) })`.
- Mount inside an Effect scope with `yield* mount(parent, App, source)`. Outside Effect, use `mountView` and call the returned `dispose()`.
- Provide services once with `uiRuntime(context)` or `makeUiRuntime()`, and pass the runtime to programs, owners and components that need `R`.

## Forms

For a few fields, use controlled inputs and `onSubmit={submit(() => …)}` (it always calls `preventDefault()`, so the page never reloads), holding drafts in `localComponent`, `defineTasks` or a controller. For many fields with validation, dirty tracking and submission state, use `@effectweb/tanstack-form` and run its `submit()` Effect in a `drop` slot.

## Testing

```ts
import { renderView, programDriver, controlledEffect } from 'effectweb/testing';

const rendered = renderView(document.body, TodoRow, { id: '1', title: 'Read', done: false });
rendered.update({ id: '1', title: 'Read', done: true }); // publish new props
rendered.sent; // messages sent by the view
rendered.dispose();
```

`controlledEffect()` gives a request you settle by hand (`succeed`, `fail`, `die`) and counts cancellations. `programDriver(program)` exposes `awaitIdle` and active slots.

## Lint setup

```json
{
  "jsPlugins": ["@effectweb/compiler/oxlint"],
  "rules": {
    "effectweb/valid-view": "error",
    "effectweb/query-key": "error",
    "effectweb/identity": "warn",
    "effectweb/render-safety": "warn"
  }
}
```

`render-safety` accepts calls to functions passed in through the model, such as `props.filterOptions(items)` or `props.renderRow(row)`. It checks those closures where the parent creates them, so create them from snapshot data rather than passing controller methods that read live state.

## Checklist before you finish

- [ ] Rows with components or inputs use `list(entities(…))` or `list(collection(…).from(…))`, with no index-based identity.
- [ ] No mutation of `model`, props or data read from snapshots; updates copy.
- [ ] Every slot is declared once; per-row work uses `commandSlots`.
- [ ] Effects run through `owner.run`, `effectCommand`, `defineTasks` or event handlers, never inside `render`/`update`.
- [ ] Submit-style actions use `drop`; searches use `replace`; writes that must all land use `queue`/`latest-queued`.
- [ ] `domMount`/`domBinding` setup functions are declared outside views.
- [ ] Links are `<Link>` elements, not buttons calling `navigate(path)`.
- [ ] `npm run check` passes with the EffectWeb lint rules enabled.
