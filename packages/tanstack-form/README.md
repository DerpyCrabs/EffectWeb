# @effectweb/tanstack-form

EffectWeb adapter for `@tanstack/form-core`. `createForm` owns a TanStack FormApi and exposes an EffectWeb source containing detached, immutable values, field errors, touched/dirty field state, validation state and submission state. Library stores never enter snapshots.

Pass `defaultValues`, a synchronous `validate(values)` returning field-path errors, an Effect-returning `onSubmit`, and `onError`. Use `setField` with TanStack deep paths, `reset`, and `submit`. Run the submission Effect in an application owner's task key. Concurrent submissions are dropped; scope interruption, reset and disposal abort active submission work. `dispose` unsubscribes and unmounts the core.

Validation operates on the whole form draft, including cross-field rules. `validateAsync(values)` returns an Effect of field-path errors and runs after synchronous validation succeeds. Submission waits for validation; transport failures appear as `validationError` and prevent saving. `validate()` returns an Effect of boolean for blur or owner-managed debounce. Editing, resetting, disposal, interruption and replacement cancel stale validation. DOM controls, labels, widgets and styling belong to the consumer.

Each submission retains its own cancellation signal. Reset detaches the previous FormApi so pending validation and completion cannot save or modify the new draft.

`source.model().fields[path]` exposes `touched`, `dirty` and `error`. Call `setTouched(path)` on blur; edits also mark a field touched and dirty. Dirty means edited since reset. Reset clears metadata. Missing entries describe untouched, pristine fields with no known error. `validating` describes a whole-draft check, not an individual field.

Disable inputs while `submitting`: edits are ignored during validation/submission started by `submit()`. Calling `validate()` during submission returns false. Individual field validators, automatic debounce and framework-specific field hooks remain outside this adapter.
