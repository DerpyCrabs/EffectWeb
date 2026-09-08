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
