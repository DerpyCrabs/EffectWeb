# @effectweb/tanstack-form

Use TanStack Form Core in an EffectWeb view. Pass `defaultValues`, TanStack `validators` and an optional `onSubmit` to `createForm`. The controller publishes values, validation errors, field metadata and submission state through `form.source`.

For input events, call `form.handleChange(path, value)` and `form.handleBlur(path)`. Use `form.setFieldValue(path, value)` for programmatic edits. To mount a field with its own validators and listeners, call `createField(form, options)` and dispose it when its view closes.

Read `form.source.model().fieldMeta[path]` for field errors and touched state. Use `getSnapshotValue(snapshot, path)` to read a field from a specific publication. Use `form.snapshotValues()` to borrow current values for an immutable projection, or `form.values()` for an independently editable copy.

Run the Effect returned by `form.submit()` through the feature's owner. The form drops concurrent submissions and exposes submission errors through `submitError`. Dispose the form when its owner closes.
