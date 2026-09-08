# Authoring EffectWeb applications

Start with the state owner you need. All of these paths use the same compiled `view` and immutable snapshots; moving to a different owner does not require rewriting the markup.

| What the feature owns                          | Starting point                              | Move on when                                                                         |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Presentation of parent data                    | `view`                                      | The feature needs editable local state                                               |
| Independent local fields                       | `localComponent`                            | A change must update several fields under a domain rule                              |
| Domain transitions and commands                | `component` + `defineActions`, or `program` | This is the general state machine path; add commands as needed                       |
| Fields and named asynchronous operations       | `defineTasks(...).tasks(...).view(...)`     | Use a custom component reducer when completion changes several domain states         |
| An imperative integration or shared controller | `modelOwner` + `defineTasks(owner, ...)`    | Keep ownership explicit when connecting multiple views                               |
| Reusable server data                           | `query` + an owned cache                    | Add application persistence or optimistic transactions when the domain requires them |

## Keep the view a projection

Views calculate presentation from their input snapshot. Event handlers send messages or call an owned action. Reading time, mutating a collection, acquiring a service, or starting a request belongs in the owner or its Effects.

Declare list identity once with `collection`/`entities`, or explicitly choose positional identity with `sequence` when position is the intended identity. A domain row ID must remain stable across edits. The compiler can reject common raw object lists, but it cannot choose your application's identity rule.

Keep unchanged branches by reference. Construct a new array for an insertion and a new object for an edited row; return the existing model for a no-op. `Snapshot<Model>` makes published nested data readonly. Development snapshot checks also catch mutation through retained references and untyped code.

## Grow local fields into domain actions

A filter toggle or temporary panel can use `localComponent`: `init` returns its fields, and the view sends patches. Its `props` field is owned by the parent.

Once a change has an invariant—for example, changing a shipping country also clears an incompatible delivery method—give that transition a name. Move the initial fields into `component.init`, define a `CountryChanged` action, and change the view's event handler from sending a patch to calling the bound action. Preserve the model fields used by the markup.

```ts
const actions = defineActions<Model>()({
  CountryChanged: (model, country: string) => ({
    model: { ...model, country, deliveryMethod: undefined },
  }),
});
```

A component keeps parent input under `props`; `receive` handles parent changes separately from local messages. Use a standalone `program` when the model belongs outside a mounted child, and connect its existing ownership with `programView` or `mountView`.

Commands are part of the transition. Use `effectCommand` to turn success or failure into a message and `mapCommand` when composing a child reducer. Scope disposal cancels owned work. Domain state should describe what the UI can display after success, failure, cancellation, or a new parent input.

## Add an asynchronous operation

For an editor with independent named operations, prefer the task builder:

```ts
const Editor = defineTasks({ init: (props: Props) => ({ draft: props.text }) })
  .tasks({
    Save: {
      policy: 'latest-queued',
      run: (model, _input: void) => saveText(model.props.id, model.draft),
      identity: (model) => model.props.id,
    },
  })
  .view(EditorView);
```

`saveText` returns an Effect. Render the task's `AsyncResult` through `AsyncContent` or an explicit result branch. Use the task's entity identity to reset work when a different document becomes the component input. The older single-task `taskComponent` remains a compatibility API; start new multi-operation editors with the builder.

Choose concurrency from the operation's meaning: replace obsolete reads, drop repeated submissions while busy, queue every accepted write, or finish the active write and retain only the newest pending save with `latest-queued`. A request captures its arguments when accepted; use an Effect to defer execution, not to accidentally reread a mutable UI variable later. Cancellation cannot undo a write already accepted by a server.

When completion must update several domain facts—for example, close a dialog, add an item, and select it—move that operation into a `component`/`program` transition. Keep the view and service Effect, and represent completion as a domain message.

## Keep editable drafts separate from parsed data

Use `defineField` from `effectweb/form` when an input needs parsing or validation. A numeric draft can be `'-'` or `'1.'` while the user is editing; converting every keystroke to a number destroys that information. The field owns draft, parse result, touch/dirty state, validation timing, reset, and stale-validation rejection. The containing component owns submission and field commands.

See the [accessible form example](../examples/profile-form) and the field API documentation for the complete integration. Connect a visible label with the input, connect errors with `aria-describedby`, and expose validation state through `aria-invalid`. Submit validates the current draft; server success determines when to replace the baseline.

## Own integrations and caches explicitly

Use `modelOwner` for imperative callbacks from a transport, browser API, or application controller. Publish patches through the owner, batch related synchronous changes in `transaction`, and register owned resources for disposal. Views read its program source; they do not subscribe independently to the transport.

Server reads belong in a `query` whose key includes every request input that changes the response: tenant, account, entity ID, filters, locale, and page cursor as appropriate. Structured keys avoid manual delimiter construction. Share a cache within its intended application/session scope; dispose or replace that scope when the signed-in identity changes. A cache is not an authorization boundary, persistent database, or multi-tab coordinator.

If a field is missing a refresh, inspect the binding's source, dependency labels, and last invalidation reason. Fix the missing input or mutation at its owner. An unconditional repaint can conceal the dependency error while leaving other consumers stale.

## Readonly data and external resources

`Snapshot<T>` protects records, nested arrays and tuples, and map/set views recursively. It also preserves readonly success data when extracting an `AsyncResult`. Reducers, view callbacks, program subscribers, owner reads, and task callbacks receive snapshots. Transitions and owner patches accept unchanged snapshot branches, so neither a no-op nor an immutable spread update needs a cast.

```ts
const actions = defineActions<{ rows: { title: string }[] }>()({
  Rename: (model, title: string) => ({
    model: { ...model, rows: model.rows.map((row) => ({ ...row, title })) },
  }),
  Keep: (model) => ({ model }),
});
```

A helper consuming published data should accept `Snapshot<Domain>` or an already readonly domain type. A helper that really needs to mutate data must create its own copy first. Avoid casting a snapshot back to a mutable type. Development checks freeze published plain objects and arrays, including retained initial values and successful async data; production correctness still depends on immutable updates. Readonly map/set types prevent mutations through the snapshot API, but development checks do not freeze their internal storage.

Functions, Effects, DOM nodes, and standard external resources keep their own API and lifecycle. TypeScript cannot infer whether an arbitrary application type is a plain record or a class instance. Mark a service class explicitly when its complete instance type must survive snapshot publication:

```ts
import type { SnapshotOpaque, snapshotOpaque } from 'effectweb';

class Transport implements SnapshotOpaque {
  declare readonly [snapshotOpaque]?: true;
  private connected = false;
  connect() {
    this.connected = true;
  }
}
```

This is a type-only declaration; it emits no marker or wrapper. Use it for resources whose state is owned outside the model. It neither makes mutable service internals reactive nor disables runtime protection of plain objects. Publish service observations as model data when they affect the UI.

## Load data while live updates continue

A readonly snapshot can still be old. A background request that replaces an entire conversation after a new message arrives will erase that message from the UI even though rendering is fully reactive.

Return request outcomes through the current owner's reducer. Give each load an identity/token and reject outcomes whose owner, entity, or request has been superseded. Publish only fields owned by that request; preserve unrelated current fields instead of spreading a model captured before the request started.

If a loader and a live stream both update the same collection, cancellation alone is insufficient. Keep the intervening domain changes for the lifetime of the load, then apply them to its result using the same reducer that handles live updates. Replay deletions as well as upserts so a late result cannot resurrect a deleted item. Release those changes on completion, cancellation, owner disposal, or selection change. This reconciliation belongs to the collection's owner, not to each view or caller.

EffectWeb's command slots prevent canceled or superseded commands from publishing stale completions. They do not infer the meaning of an application's independently produced snapshots. The dependency inspector can show whether the view updated correctly; a stale data overwrite must be fixed at the publishing owner.
