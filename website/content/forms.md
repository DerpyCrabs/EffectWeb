For a form with a few fields, use controlled inputs in a [component](/docs/components/). For a large form with validation, use `@effectweb/tanstack-form`.

## Small forms

Bind each input's `value` to the model and update it in `onInput`. Wrap the submit handler in `submit`, which calls `preventDefault()` so the page does not reload. Receive the owner with `owner => view(…)` and save with `owner.task` and the `drop` policy, so a second click while saving does nothing.

```tsx check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { component, resourceError, submit, view, type Snapshot } from 'effectweb';

type Props = {
  readonly id: string;
  readonly title: string;
  readonly save: (id: string, title: string) => Effect.Effect<void, Error>;
};

type State = { readonly draft: string; readonly saved: AsyncResult.AsyncResult<void, Error> };

export const RenameForm = component(
  {
    init: (props: Snapshot<Props>): State => ({ draft: props.title, saved: AsyncResult.initial() }),
    identity: (props) => props.id,
  },
  (owner) =>
    view((model) => {
      const saving = model.saved.waiting;
      const save = () =>
        owner.task('saved', model.props.save(model.props.id, model.draft.trim()), 'drop');
      return (
        <form onSubmit={submit(save)}>
          <label>
            Title
            <input
              required
              value={model.draft}
              onInput={(event) => owner.patch({ draft: event.currentTarget.value })}
            />
          </label>
          <button disabled={saving || !model.draft.trim()}>{saving ? 'Saving…' : 'Save'}</button>
          {AsyncResult.isFailure(model.saved) ? (
            <p role="alert">{resourceError(model.saved)}</p>
          ) : null}
        </form>
      );
    }),
);
```

`identity: (props) => props.id` resets the draft when the form starts editing a different document.

## Large forms

`@effectweb/tanstack-form` wraps TanStack Form Core. It tracks values, validation errors, dirty state and submission, and publishes them as an immutable snapshot.

```ts check
import { Effect } from 'effect';
import { modelOwner } from 'effectweb';
import { createForm } from '@effectweb/tanstack-form';

const submitKey = 'profile-submit';

export function profileForm(save: (values: { name: string }) => Effect.Effect<void, Error>) {
  const owner = modelOwner({});
  const form = owner.own(
    createForm({
      defaultValues: { name: '' },
      validate: (values) => (values.name.trim() ? {} : { name: 'Enter a name' }),
      onSubmit: save,
      onError: (error) => (error instanceof Error ? error.message : 'Could not save'),
    }),
  );
  return {
    source: form.source,
    setName: (name: string) => form.setField('name', name),
    submit: () => owner.run(submitKey, form.submit(), 'drop'),
    reset: () => form.reset(),
    lifetime: owner,
  };
}
```

The view reads `values`, `errors`, `dirty`, `submitting` and `submitError` from `form.source`. Markup and styling stay in your app. `reset()` and `dispose()` abort a submission in progress.

Use `validate` for synchronous checks and `validateAsync` for requests such as checking whether a username is taken. See below for field state and cancellation.

See the [form API](/docs/api-integrations/#effectweb-tanstack-form) for every option.

## Async validation and field state

Add `validateAsync` for checks that require a request. It returns an Effect containing field-path errors. Synchronous validation runs first; submission waits for both and saves only a valid draft. Request failures appear in `validationError`, separately from `submitError`.

```ts check
import { Effect } from 'effect';
import { createForm } from '@effectweb/tanstack-form';

declare const users: {
  available: (name: string) => Effect.Effect<boolean, Error>;
  save: (values: { name: string }) => Effect.Effect<void, Error>;
}; // @hide

export const form = createForm({
  defaultValues: { name: '' },
  validate: ({ name }) => (name.trim() ? {} : { name: 'Enter a name' }),
  validateAsync: ({ name }) =>
    users
      .available(name)
      .pipe(Effect.map((available) => (available ? {} : { name: 'Already taken' }))),
  onSubmit: users.save,
  onError: String,
});
```

`form.validate()` returns an Effect of `boolean`. Run it on blur or through an owner’s debounced `replace` task while typing. Edits, reset, disposal, caller interruption and a newer validation cancel the previous check; obsolete results never replace current errors. `submit()` always checks the current draft again. An explicit `validate()` during submission returns `false` without interrupting the save.

The snapshot exposes:

- `validating` and `validationError` for the whole draft’s async check;
- `fields[path].touched`, `.dirty` and `.error` for each edited, touched or invalid field;
- `errors[path]` for all current field errors.

Call `setTouched(path)` on blur without changing the value. Editing also marks a field touched and dirty. Dirty means edited since reset, even if the value is changed back. A field absent from `fields` is untouched, pristine and has no known error. Show an error when the field is touched or the form has been submitted. Reset clears field state and validation results.

Validators receive a detached draft. Validation covers the whole form, including cross-field rules; individual field validators and automatic debounce are not built in. While submission is running, edits are ignored, so disable inputs with `submitting`.
