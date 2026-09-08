# Profile form

Run from the repository root after `npm ci` and `npm run build`:

```sh
npx vp dev --config examples/profile-form/vite.config.ts
npx vp build --config examples/profile-form/vite.config.ts
```

This example uses `defineField`, `program`, and compiled `view`. The program owns both availability checks and saving, and unmounting disposes their fibers. The demo service uses local delayed Effects; replace `ProfileService` to connect real storage.

`defineField({ id, parse, validateOn, validate })` creates a reusable immutable field reducer. Use a unique ID for each field inside a program, call `init(draft)` for initial state, and delegate field messages to `update(state, message)`. Lift commands with `mapCommand` so their results return to the correct nested field; forward `cancel` slots as well. Effects requiring services retain their requirements in the returned `Transition`, which can be provided by the enclosing component's `runtime`.

- Drafts are native strings or booleans. The pure parser runs on init, edit and reset, producing `{ ok: true, value }` or `{ ok: false, error }`. It never replaces the draft. For example, `"007"` remains visible while the domain value is `7`; `"-"` stays editable and has no domain value.
- `parsed` always describes the current draft. `error` is the display error and is absent until validation runs. `validation` is `idle`, `pending`, `valid` or `invalid`; only `valid` confirms that the current parsed value passed validation. Read `parsed.value` after narrowing `parsed.ok` and checking validation before saving.
- `validateOn` is `change`, `blur` (default), or `submit`. `Validate` always validates and marks the field touched; `Blur` marks it touched and validates only under the blur policy. Editing clears old display errors and returns validation to idle unless change validation is selected. It does not automatically revalidate a touched field under another policy.
- `dirty` compares the exact draft with its initial baseline, so editing back to the original value clears it. `Reset` restores that baseline, clears touched/errors, and cancels work. `Reset` with a `draft` establishes a new baseline.
- Optional async `validate(value)` returns an Effect of an error string or `undefined`. Parsing failures skip it. Typed failures and defects become a retryable display error; customize this with `onFailure(cause)`. A new edit, reset or validation cancels the old command. Revision checks also ignore stale and duplicate settlement messages.

Submission is an application decision: this example validates every field, waits for availability, then sends only parsed domain values to `save`. Edits cancel a pending submission; reset cancels both validation and saving. Labels, help text, error IDs, `aria-describedby`, `aria-invalid`, and live status messages are ordinary JSX. No generated control markup or additional JSX syntax is required.

Browser coverage lives in `tests/browser/profile-form.spec.ts`; reducer and cancellation tests live in `packages/runtime/src/form.test.ts`. The existing `inputText`, `inputChecked`, `inputNumber`, and `submit` adapters remain compatible. Use `inputText` for numeric drafts that must retain incomplete input or formatting; `inputNumber` is still useful when only a native parsed number is needed.
