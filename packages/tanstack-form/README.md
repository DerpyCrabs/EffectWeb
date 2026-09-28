# @effectweb/tanstack-form

EffectWeb adapter for `@tanstack/form-core`. `createForm` owns a TanStack FormApi and exposes an EffectWeb source containing detached, immutable values, field errors, dirty state and submission state. Library stores never enter snapshots.

Pass `defaultValues`, a synchronous `validate(values)` returning field-path errors, an Effect-returning `onSubmit`, and `onError`. Use `setField` with TanStack deep paths, `reset`, and `submit`. Run the submission Effect in an application owner's task slot. Concurrent submissions are dropped; scope interruption, reset and disposal abort active submission work. `dispose` unsubscribes and unmounts the core.

Validation operates synchronously on the whole form draft. Asynchronous field validators and framework-specific field hooks are not exposed. DOM controls, labels, widgets and styling belong to the consumer.

Each submission retains its own cancellation signal. Reset detaches the previous FormApi so pending validation and completion cannot save or modify the new draft.
