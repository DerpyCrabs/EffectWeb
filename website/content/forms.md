For a form with a few fields, use controlled inputs in a [component](/docs/components/). For a large form with validation, use `@effectweb/tanstack-form`.

## Small forms

Bind each input's `value` to the model and update it in `onInput`. In the submit handler, call `preventDefault()` so the page does not reload, then return the save. Receive the owner with `owner => view(…)` and save with `owner.task` and the `drop` policy, so a second click while saving does nothing.

```tsx check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { component, resourceError, view } from 'effectweb';

type Props = {
  readonly id: string;
  readonly title: string;
  readonly save: (id: string, title: string) => Effect.Effect<void, Error>;
};

type State = { readonly draft: string; readonly saved: AsyncResult.AsyncResult<void, Error> };

export const RenameForm = component(
  {
    init: (props: Props): State => ({ draft: props.title, saved: AsyncResult.initial() }),
    identity: (props) => props.id,
  },
  (owner) =>
    view((model) => {
      const saving = model.saved.waiting;
      const save = () =>
        owner.task('saved', model.props.save(model.props.id, model.draft.trim()), 'drop');
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            return save();
          }}
        >
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

`@effectweb/tanstack-form` wraps TanStack Form Core. The form owns the draft, its validators, listeners and submission; EffectWeb publishes TanStack's state as an immutable snapshot.

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
      validators: {
        onSubmit: ({ value }) =>
          value.name.trim() ? undefined : { fields: { name: 'Enter a name' } },
      },
      onSubmit: ({ value }) => save(value),
      onError: (error) => (error instanceof Error ? error.message : 'Could not save'),
    }),
  );
  return {
    source: form.source,
    setName: (name: string) => form.handleChange('name', name),
    blurName: () => form.handleBlur('name'),
    submit: () => owner.run(submitKey, form.submit(), 'drop'),
    reset: () => form.reset(),
    lifetime: owner,
  };
}
```

The snapshot is TanStack's form state: `values`, `errors`, `errorMap`, `fieldMeta[path]` with `errors`, `isTouched`, `isBlurred`, `isDirty`, `isValidating` and `isValid`, plus `isValid`, `canSubmit`, `isSubmitting`, `isSubmitted`, `isSubmitSuccessful` and `submissionAttempts`. `submitError` holds the message of a failed save until the next edit, reset or submission. Markup and styling stay in your app. `reset()` and `dispose()` interrupt a submission in progress.

`validators` take every TanStack cause: `onMount`, `onChange`, `onBlur`, `onSubmit`, `onDynamic`, each with an `Async` variant debounced by `asyncDebounceMs`, as functions or Standard Schema validators. `listeners` and `canSubmitWhenInvalid` are TanStack's too. `onSubmit` may return an Effect; it is interrupted when the submission is.

See the [form API](/docs/api-integrations/#effectweb-tanstack-form) for every option.

## Fields

`createField` mounts one field of a form, the counterpart of TanStack's `useField`. Field validators and listeners run with the form's validators of the same cause, and the field's meta joins the form snapshot.

```ts check
import { createField, createForm } from '@effectweb/tanstack-form';

declare const users: { available: (name: string) => Promise<boolean> }; // @hide

export const form = createForm({ defaultValues: { name: '', tags: [] as string[] } });
export const name = createField(form, {
  name: 'name',
  asyncDebounceMs: 300,
  validators: {
    onChange: ({ value }) => (value.trim() ? undefined : 'Enter a name'),
    onChangeAsync: async ({ value }) =>
      (await users.available(value)) ? undefined : 'Already taken',
  },
});
export const tags = createField(form, { name: 'tags' });
```

A field publishes `{ value, meta }`. Bind an input with `handleChange` and `handleBlur`; array fields add `pushValue`, `insertValue`, `replaceValue`, `removeValue`, `swapValues`, `moveValue` and `clearValues`. The form offers the same array helpers by path, and `handleChange(path, value)` and `handleBlur(path)` for inputs without a field of their own. Dispose a field with the view that renders it.

Validators receive TanStack's arguments and run against the live draft; snapshots and values returned by `values()` and `getValue()` are detached copies. Every snapshot is frozen, so keep edits on the form.
