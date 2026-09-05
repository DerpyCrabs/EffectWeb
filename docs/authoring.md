# Component authoring

The compiler accepts snapshot JSX: read plain immutable values, derive constants, and return JSX. It generates dependency checks and DOM updates. State changes still go through messages or an owned Effect; there is no implicit signal tracking.

## Named actions without a second payload declaration

`defineActions<Model>()` derives message payloads and dispatch methods from handlers:

```ts
const actions = defineActions<{ query: string }>()({
  Query: (model, query: string) => ({ model: { ...model, query } }),
  Clear: () => ({ model: { query: '' } }),
});
type Message = ActionMessage<typeof actions>;
```

Pass `actions.update` to a program's update function. Bind once in a compiled view:

```tsx
const dispatch = actions.bind(send);
return <input value={model.query} onInput={inputText(dispatch.Query)} />;
```

Outside the view, `source.send(actions.message.Query('hello'))` uses the same payload types. Handlers return ordinary transitions, including commands and cancellations. The existing queue preserves ordering; the methods do not mutate the model directly. Search combines these actions with the shared pagination messages.

## Children and typed slots

Ordinary component children and named markup props are compiled templates:

```tsx
<Dialog title="Search messages" onClose={dispatch.Close} footer={<p>Search this chat</p>}>
  <SearchForm query={model.query} onQuery={dispatch.Query} />
</Dialog>
```

A receiving view declares `children?: JSX.Element` or `footer?: JSX.Element` and renders `{props.children}` or `{props.footer}`. Each placement has its own DOM and local state, even when the same content is placed twice. Captured caller values and event handlers use the latest snapshot without remounting the content. Placement removal runs its cleanups.

Use `slot` when the receiver supplies a value to the markup:

```tsx
const content = slot((count: number) => (
  <strong>
    {model.label}: {count}
  </strong>
));
return <Counter content={content} />;
```

`Counter` declares `content: Slot<number>` and renders `{props.content(model.count)}`. Type checks reject a wrong argument or rendering a required-value slot bare. Declare slots inside a `view` or directly in a JSX prop; they belong to that view's lifetime. A slot callback accepts one named parameter; destructure it inside its body if needed. Zero-argument slots and ordinary markup props need no argument at placement.

The native compiler still requires pure snapshot derivations. Slots do not introduce a virtual tree or an implicit reactive context. `Dialog` provides focus containment, overlay dismissal and accessible labeling.

## Named tasks with inferred results

Use `defineTasks` for editable fields and independently owned operations. Define tasks before the view so TypeScript can infer each operation's input, success and error type without a result annotation:

```tsx
const editor = defineTasks({
  init: (_props: { save: (text: string) => Effect.Effect<number, SaveError> }) => ({ text: '' }),
}).tasks({
  save: { policy: 'drop', run: (model) => model.props.save(model.text) },
  preview: { policy: 'replace', run: (model) => Effect.succeed(model.text.toUpperCase()) },
});
const Editor = editor.view(
  view((model, send) => {
    const actions = editor.controls(send);
    return (
      <form onSubmit={submit(() => actions.run('save'))}>
        <input value={model.text} onInput={inputText((text) => actions.patch({ text }))} />
        <button disabled={model.tasks.save.waiting}>Save</button>
        <p role="status">{resourceError(model.tasks.save)}</p>
      </form>
    );
  }),
);
```

`SaveError` above is the application's expected error type. An input annotation on `run(model, input: Input)` establishes the second argument to `actions.run('name', input)`. A run without an input parameter needs no placeholder `void` argument. Result snapshots are ordinary Effect `AsyncResult<A, E>` values. Editable patches cannot overwrite props or task results; completion messages are private to the task owner.

Choose concurrency and identity deliberately:

- `drop` ignores another run while that named task is pending.
- `replace` interrupts that task's previous run and accepts the new one.
- `identity(props)` on `defineTasks` resets all fields/results and cancels all work when the component entity changes.
- `identity(model)` on one task resets/cancels only that operation when its domain identity changes.
- `cancel('name')` interrupts work, stops waiting and retains an available result. `reset('name')` also clears its result.

Each accepted run reads one immutable snapshot. Different task names can run independently. Unmount interrupts all of them. Throwing factories and defects settle pending state as a failed `AsyncResult` with a `Cause`; expected errors retain their declared type. Completion side effects belong in the Effect chain so interruption suppresses later steps. An underlying Promise aborts external work only if its API honors the signal passed by `fromPromise`.

Named tasks suit independent operations such as submitting a form or preparing a preview. The older `taskComponent` remains compatible, but new code should use staged definitions. Keep ordinary `component`/`program` transitions for workflows that need atomic domain updates, such as optimistic edits and persistence.

## Application services

Bind services once with `uiRuntime(context)` and pass that runtime before declaring service-using tasks:

```ts
const runtime = uiRuntime(Context.make(Drafts, draftsService));
const editor = defineTasks({ runtime, init: (_props: { id: string }) => ({ text: '' }) }).tasks({
  save: {
    policy: 'drop',
    run: (model) => Effect.flatMap(Drafts, (drafts) => drafts.save(model.props.id, model.text)),
  },
});
```

`Drafts` is an application `Context.Service`. Missing service requirements fail type checking in the task definition. The runtime provides a context; it does not create a service scope per component. The application must acquire and release any scoped services for the lifetime of the app. Individual command fibers belong to their program or component and are interrupted independently.

Use `runtime.program(...)` for manual transitions requiring services; `component` and `resourceComponent` also accept `runtime`. `runtime.provide(effect)` adapts smaller integrations such as an `effectEvent`. `UiLoad<A, E, R>` and commands preserve the Effect error and requirement parameters. The [reading-list example](../examples/reading-list/app.tsx) supplies a typed storage service once, retaining its atomic optimistic reducer.

## Async content and forms

`AsyncContent` renders an existing result; loading, resource identity and caching remain with its owner:

```tsx
<AsyncContent
  result={model.result}
  content={slot((items: readonly Item[]) => (
    <Results items={items} />
  ))}
  pending={<p role="status">Loading…</p>}
  pendingDelay={150}
  refreshing={<p role="status">Refreshing…</p>}
  failure={slot((cause: Cause.Cause<LoadError>) => (
    <ErrorDetails cause={cause} />
  ))}
/>
```

Available success keeps its DOM through a refresh and a failed refresh. A failure slot appears alongside retained content, or on its own if no data exists. `pendingDelay` delays only the initial pending indicator; it defaults to zero. `empty` renders an initial, nonwaiting result. Successful `undefined`, `false`, zero and empty strings are available data, not pending states.

This component cannot infer entity identity. `resourceComponent` publishes an initial result on key changes. If an owner swaps directly between two cached successes, editable children must use their own explicit entity identity to reset local state. Display failed requests explicitly instead of silently presenting an empty list.

`inputText`, `inputChecked` and `inputNumber` capture native values synchronously and dispatch immutable changes. Numeric empty/invalid input becomes `undefined`; raw editable strings can remain strings when formatting matters. `submit` synchronously prevents the native form submission before dispatching or returning an owned Effect event request. These helpers add no validation state or proxies. Keep specialized contenteditable/composer behavior in its existing owner. Schema decoding belongs at the domain boundary.

## Shared query definitions

A query groups logical identity, loading, freshness and types:

```ts
const profile = query({
  name: 'profile',
  key: (id: string) => id,
  load: (id: string) => Effect.flatMap(Profiles, (service) => service.get(id)),
  staleTime: 30_000,
});
const cache = makeQueryCache(runtime);
const selected = queryResource({ cache, changed }, profile);
selected.select('alice');
// Commands use the same cache and definition:
cache.prefetch(profile, 'alice'); // an Effect; run it through an owner
cache.invalidateQuery(profile, 'alice');
```

Share the definition at module or application scope. Its private identity distinguishes definitions even when diagnostic names match; `key(args)` distinguishes resources within it. Declare singleton reads as `query({ name, load: () => effect })` and activate with `select(true)`. `select(undefined)` clears a selection.

`queryResource.select` reconciles identity idempotently. Freshness is checked on activation, reactivation and prefetch; repeated same-key snapshot updates do not refetch. Call `refresh()` to explicitly refresh an active selection. Freshness defaults to explicit invalidation, and the existing cache still expires idle values after its 30-second TTL. `invalidateQuery(definition)` invalidates that definition's entries; adding arguments targets one entry. Prefetch and views deduplicate through the same AtomRegistry and preserve unchanged result references.

An application owns cache isolation and disposal. Query helpers cache resources in memory; they do not persist data or coordinate browser tabs. Call `cache.dispose()` when its application lifetime ends.

## Program tests and diagnostics

Import `programDriver` and `controlledEffect` from `effectweb/testing` in tests. The driver uses the real program queue, exposes `model`, `send`, `activeSlots`, `awaitSlot('task:save')` and `awaitIdle()`, and disposes its source. A controlled Effect lets a test explicitly succeed, fail or interrupt work without constructing private settlement messages. Supply a runtime containing Effect's test services to advance `TestClock` through `driver.run(...)`.

`observePrograms(100)` records a bounded, opt-in history of program IDs, optional names, message discriminants and command slot lifecycle. Call `.events()` to inspect and `.dispose()` to stop. It retains no payloads or model snapshots and cannot replay commands. Pair it with `observeBindings` for compiler source locations and changed dependency paths. Without program observers, updates skip diagnostic metadata allocation.

## Effect event handlers

For an Effect with no view-owned result, use an explicitly owned event:

```tsx
<button onClick={effectEvent('drop', () => props.retry())}>Retry</button>
```

The factory runs synchronously on **every event**, including dropped events. Capture native event fields and call `preventDefault()` there. Return a cold Effect for the actual operation; `drop`/`replace` controls its execution. The fiber belongs to that DOM listener and is interrupted when its branch or component is removed. Failures and defects use the scope's error reporter. This is appropriate for small actions; use task state when the UI needs pending/error/result feedback.

JSX event types reject directly returned Effects and Promises. The runtime also reports them if JavaScript or a cast bypasses the type check. `effecttsgo/floating-effect` is an error in `npm run check` and catches discarded Effect expression statements. Explicit `void effect`, `any`, and callbacks already typed `() => void` can conceal a discarded value; these remain escape hatches, not checked guarantees. Do not use `void` to launch a cold Effect. Adapt Promise APIs with `fromPromise` and provide an owner.

## Ordinary control flow

Views, JSX helpers, and list callbacks can use pure constants, early `if`/`else` returns, and returning `switch` cases. Each selected branch has its own scope. Updates within the same branch preserve DOM and child state; changing branches disposes the old scope. Grouped empty case labels share a branch. Nonempty fallthrough, `break`, incomplete returns, and unreachable statements receive compiler diagnostics.

Use branch constants for union narrowing and keep helper declarations after the constants they capture. Effects and imperative mutations belong in events or commands. Domain collections still declare stable identity once; the compiler cannot invent the identity of messages or attachments.

Use fragments when they group multiple children or preserve meaningful whitespace.

## Native event work

Inline `onX` callbacks may read browser APIs and reset the event target, for example `event.currentTarget.value = ''` after capturing a file input. They read the current model when the event fires. View derivations still reject browser globals and mutations; event callbacks cannot assign model fields. Asynchronous application work still needs a command or `effectEvent`, which owns cancellation and errors.

## Application model ownership

`modelOwner` uses the same `program` queue as components. It supplies immutable patching and synchronous transactions for application workflows that otherwise need their own state and task owner:

```ts
const app = modelOwner({ selected: '', text: '', saved: false });
const { read, patch, edit, transaction, run } = app;

transaction(() => {
  patch({ selected: 'first' });
  edit('text', (text) => text.trim());
});
run('save', save(read().text), 'drop');
```

Readers see staged state inside a transaction. Subscribers see one committed snapshot, before its tasks start. A throw rolls back that transaction's patches and tasks; nested transactions behave as savepoints. Transactions cannot await. An asynchronous workflow belongs in `run`, with transactions around its synchronous groups of changes.

`run` accepts an Effect and defaults to replacing the previous task in that slot. `drop` ignores a new request while the slot is busy. `parallel` permits independent tasks in the same slot. `cancel(slot)` cancels the entire slot, and `isRunning(slot)` reports whether it is busy. These policies also work within a transaction. Error reporting can be supplied through `onDefect`; service requirements can be supplied through `runtime: uiRuntime(context)`.

Mount `app.source` as a program source. Disposing either `app` or `app.source` cancels its tasks and disposes resources registered with `app.own(resource)`. Methods are bound functions and can be destructured. Use ordinary `program` reducers for explicit domain messages; both authoring interfaces share its publication and command semantics.

## Owned query subscriptions

Keep `AsyncResult` in the model rather than converting it into another loading-state object:

```ts
const empty = <A>(): AsyncResult.AsyncResult<A, Error> => AsyncResult.initial();
const app = modelOwner({ profile: empty<Profile>() });
const cache = app.own(makeQueryCache());
const profile = observeQuery(app, cache, profileQuery, (result) => {
  app.patch({ profile: result });
});
profile.select('alice');
```

`observeQuery` publishes the typed Effect result on selection and settlement. No work begins until selection. The owner releases its subscription; another owner observing the same cache entry remains subscribed. `refresh()` joins an in-flight request, and a failed refresh retains the prior success. `select(undefined)` clears the selection. Resetting the cache clears the observation until it is selected again.

Use `AsyncResult.value(result)` when a successful `undefined` must be distinguished from no data. `available(result)` is convenient when the application value itself cannot be `undefined`. `resourceError(result)` produces display text and uses `Error.message` for Error objects. It does not replace the typed cause stored in the result.

Register a privately owned cache before its observations, as above, so disposal releases observations before the cache. A cache shared across owners should be owned by their common application lifetime. Low-level `queryResource` also exposes `subscribe` for integrations that already own their disposal.

## Destructured view inputs

```tsx
const Title = view(({ title, user: { name } }: Props) => (
  <h1>
    {title}: {name}
  </h1>
));
```

Simple object patterns compile to field dependencies directly. Renaming, nested patterns, defaults, computed keys, array patterns and rest bindings are supported. Complex patterns use a cached derivation that retains JavaScript's default and rest behavior. Event closures capture values from the snapshot at dispatch time.

Keep the optional dispatch parameter named. Whole-parameter defaults and rest parameters remain unsupported. Defaults that reference dispatch should be declared inside the view body.

## Checks while authoring

The compiler package includes an Oxlint plugin. It runs the same Rust view analysis as a build, so unsupported control flow, mutations, and impure derivations appear in your editor and lint command. It collects the first error in each invalid view and continues checking later views.

```json
{
  "jsPlugins": ["@effectweb/compiler/oxlint"],
  "rules": { "effectweb/valid-view": "error", "effectweb/whole-model-dependency": "warn" }
}
```

In Vite+, put these fields under `lint` in the Vite configuration. The Oxlint editor integration uses that configuration too. The optional whole-model rule reports calls such as `format(model)` that prevent field-level dependency checks; it does not prove that an expensive computation occurs. Disable that advice if whole-model derivations are intentional. A custom view import can be configured as `["error", { "importSource": "./ui" }]`, matching the compiler option. Suppressing a lint error does not make invalid code compile.

Keep Effect-aware diagnostics enabled alongside this plugin. The apps use `@effect/tsgo`, its `effect-tsgo patch --oxlint` installation step, `effecttsgo` in `plugins`, type-aware linting, and `effecttsgo/floating-effect: "error"`. Ordinary TypeScript checking and the EffectWeb plugin cannot identify every discarded cold Effect. Explicit `void`, `any`, or an already widened `() => void` callback can still hide a discarded result. Lint does not infer the correct cancellation policy or domain identity.

Tooling can call `diagnose(source, filename, options)` from `@effectweb/compiler` for the same structured view diagnostics without emitting code or a source map. Locations use one-based lines and UTF-16 columns. Invalid syntax and native loading failures throw; a linter's parser handles syntax diagnostics before invoking this plugin.

## Published snapshot protection

`modelOwner.read()`, `Program.model()`, program reducers, and subscribers expose `Snapshot<Model>`, which makes published fields readonly. `edit` receives a readonly field value and can return that same value for a no-op, without making a copy. Use readonly nested domain types for static protection of nested data; the framework does not recursively rewrite types of services and other opaque values.

The Vite plugin also enables snapshot checks during development. Publication freezes plain objects and arrays recursively, including data reachable through retained input references. Mutation throws at the assignment in strict-mode application modules. A transaction read protects its staged data as well. Already checked shared branches are tracked weakly, so ordinary updates only walk newly introduced data. The guard never invokes getters or traverses functions or class instances such as Effects, DOM nodes, editors, Maps, and Dates. Plain records are treated as data, including their symbol fields. Successful data inside `AsyncResult` is checked too, including a previous success retained after a failed refresh; the Effect wrapper itself is left intact.

These checks preserve object identity; they do not clone models, create proxies, or make mutation reactive. Mutable state inside opaque instances and getters remains outside this protection. A frozen model cannot be made mutable again by disabling checks later.

Production builds disable automatic checks. Outside the Vite plugin, tests and other hosts can opt in explicitly:

```ts
const app = modelOwner({ items: [{ id: 'first', title: 'Draft' }] }, { checkSnapshots: true });
app.edit('items', (items) => items.map((item) => ({ ...item, title: 'Saved' })));
```

`program` and `uiRuntime(...).program` accept the same option. Tests should verify the immutable publication contract through normal reads, edits, and subscriptions.
