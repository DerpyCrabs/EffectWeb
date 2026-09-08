import { commandSlot } from 'effectweb';
import './style.css';
import { Effect } from 'effect';
import {
  defineField,
  inputText,
  mountView,
  program,
  submit,
  view,
  type FieldMessage,
  type FieldResult,
  type FieldState,
  type Transition,
} from 'effectweb';
import { effectCommand, mapCommand } from 'effectweb/program';

const commandSave = commandSlot('save');

export interface Profile {
  readonly username: string;
  readonly weeklyHours: number;
}
export interface ProfileService {
  readonly available: (username: string) => Effect.Effect<string | undefined>;
  readonly save: (profile: Profile) => Effect.Effect<Profile, string>;
}
export const demoService: ProfileService = {
  available: (username) =>
    Effect.succeed(username === 'admin' ? 'This username is already taken.' : undefined).pipe(
      Effect.delay('250 millis'),
    ),
  save: (profile) => Effect.succeed(profile).pipe(Effect.delay('150 millis')),
};

type Model = {
  readonly username: FieldState<string, string>;
  readonly hours: FieldState<string, number>;
  readonly status: 'editing' | 'validating' | 'saving' | 'saved';
  readonly saved: Profile | undefined;
  readonly saveError: string | undefined;
};
type Message =
  | { readonly type: 'Username'; readonly message: FieldMessage<string> }
  | { readonly type: 'Hours'; readonly message: FieldMessage<string> }
  | { readonly type: 'Submit' }
  | { readonly type: 'Reset' }
  | { readonly type: 'Saved'; readonly profile: Profile }
  | { readonly type: 'SaveFailed' };

/** Owns validation and save fibers in the same program as the immutable form model. */
export function createProfileForm(service: ProfileService = demoService) {
  const username = defineField({
    id: 'username',
    validateOn: 'blur',
    parse: (draft: string): FieldResult<string> =>
      /^[a-z][a-z0-9_]{2,19}$/.test(draft)
        ? { ok: true, value: draft }
        : {
            ok: false,
            error: 'Use 3–20 lowercase letters, numbers or underscores; start with a letter.',
          },
    validate: service.available,
  });
  const hours = defineField({
    id: 'hours',
    validateOn: 'blur',
    parse: (draft: string): FieldResult<number> =>
      /^\d+$/.test(draft) && Number(draft) >= 1 && Number(draft) <= 40
        ? { ok: true, value: Number(draft) }
        : { ok: false, error: 'Enter a whole number from 1 to 40.' },
  });
  const liftUsername = (
    model: Model,
    message: FieldMessage<string>,
  ): Transition<Model, Message> => {
    const next = username.update(model.username, message);
    return {
      model: { ...model, username: next.model },
      cancel: next.cancel ?? [],
      commands:
        next.commands?.map((command) =>
          mapCommand(command, (message): Message => ({ type: 'Username', message })),
        ) ?? [],
    };
  };
  const liftHours = (model: Model, message: FieldMessage<string>): Transition<Model, Message> => {
    const next = hours.update(model.hours, message);
    return {
      model: { ...model, hours: next.model },
      cancel: next.cancel ?? [],
      commands:
        next.commands?.map((command) =>
          mapCommand(command, (message): Message => ({ type: 'Hours', message })),
        ) ?? [],
    };
  };
  const finishValidation = (next: Transition<Model, Message>): Transition<Model, Message> => {
    const model = next.model;
    if (model.status !== 'validating') return next;
    if (model.username.validation === 'invalid' || model.hours.validation === 'invalid') {
      return { ...next, model: { ...model, status: 'editing' } };
    }
    if (
      model.username.validation !== 'valid' ||
      model.hours.validation !== 'valid' ||
      !model.username.parsed.ok ||
      !model.hours.parsed.ok
    )
      return next;
    const profile = {
      username: model.username.parsed.value,
      weeklyHours: model.hours.parsed.value,
    };
    return {
      ...next,
      model: { ...model, status: 'saving' },
      commands: [
        ...(next.commands ?? []),
        effectCommand(commandSave, () => service.save(profile), {
          policy: 'replace',
          onSuccess: (profile): Message => ({ type: 'Saved', profile }),
          onFailure: (): Message => ({ type: 'SaveFailed' }),
        }),
      ],
    };
  };
  return program<Model, Message>({
    name: 'profile-form',
    initial: {
      username: username.init(''),
      hours: hours.init('05'),
      status: 'editing',
      saved: undefined,
      saveError: undefined,
    },
    update: (model, message) => {
      switch (message.type) {
        case 'Username':
        case 'Hours': {
          const editing = message.message.type === 'Change' || message.message.type === 'Reset';
          const next = (message.type === 'Username' ? liftUsername : liftHours)(
            editing
              ? { ...model, status: 'editing', saved: undefined, saveError: undefined }
              : model,
            message.message,
          );
          return finishValidation(
            editing ? { ...next, cancel: [...(next.cancel ?? []), commandSave] } : next,
          );
        }
        case 'Submit': {
          if (model.status === 'validating' || model.status === 'saving') return { model };
          const first = liftUsername(
            { ...model, status: 'validating', saved: undefined, saveError: undefined },
            { type: 'Validate' },
          );
          const second = liftHours(first.model, { type: 'Validate' });
          return finishValidation({
            model: second.model,
            commands: [...(first.commands ?? []), ...(second.commands ?? [])],
            cancel: [...(first.cancel ?? []), ...(second.cancel ?? [])],
          });
        }
        case 'Reset': {
          const first = liftUsername(model, { type: 'Reset' });
          const second = liftHours(first.model, { type: 'Reset' });
          return {
            model: { ...second.model, status: 'editing', saved: undefined, saveError: undefined },
            cancel: [...(first.cancel ?? []), ...(second.cancel ?? []), commandSave],
          };
        }
        case 'Saved':
          return { model: { ...model, status: 'saved', saved: message.profile } };
        case 'SaveFailed':
          return {
            model: { ...model, status: 'editing', saveError: 'Could not save. Try again.' },
          };
      }
    },
  });
}

const ProfileView = view<Model, Message>((model, send) => (
  <main>
    <h1>Your contributor profile</h1>
    <p>
      Choose a public username and your weekly availability. Try “admin” to see availability
      validation.
    </p>
    <form noValidate onSubmit={submit(() => send({ type: 'Submit' }))}>
      <label id="profile-username-label" htmlFor="profile-username">
        Username
      </label>
      <p id="profile-username-help">3–20 lowercase letters, numbers or underscores.</p>
      <input
        id="profile-username"
        name="username"
        autocomplete="username"
        value={model.username.draft}
        aria-describedby={
          model.username.error
            ? 'profile-username-help profile-username-error'
            : 'profile-username-help'
        }
        aria-invalid={model.username.validation === 'invalid'}
        aria-busy={model.username.validation === 'pending'}
        onInput={inputText((draft) =>
          send({ type: 'Username', message: { type: 'Change', draft } }),
        )}
        onBlur={() => send({ type: 'Username', message: { type: 'Blur' } })}
      />
      <p id="profile-username-error" role="alert">
        {model.username.error ?? ''}
      </p>
      <p role="status">{model.username.validation === 'pending' ? 'Checking availability…' : ''}</p>
      <label id="profile-hours-label" htmlFor="profile-hours">
        Weekly hours
      </label>
      <p id="profile-hours-help">A whole number from 1 to 40. Your draft keeps its formatting.</p>
      <input
        id="profile-hours"
        name="weeklyHours"
        inputMode="numeric"
        type="text"
        value={model.hours.draft}
        aria-describedby={
          model.hours.error ? 'profile-hours-help profile-hours-error' : 'profile-hours-help'
        }
        aria-invalid={model.hours.validation === 'invalid'}
        onInput={inputText((draft) => send({ type: 'Hours', message: { type: 'Change', draft } }))}
        onBlur={() => send({ type: 'Hours', message: { type: 'Blur' } })}
      />
      <p id="profile-hours-error" role="alert">
        {model.hours.error ?? ''}
      </p>
      <p data-dirty="">
        {model.username.dirty || model.hours.dirty ? 'Unsaved changes' : 'No changes'}
      </p>
      <button type="submit" disabled={model.status === 'validating' || model.status === 'saving'}>
        Save profile
      </button>
      <button type="button" onClick={() => send({ type: 'Reset' })}>
        Reset
      </button>
      <p role="status">{model.status === 'saving' ? 'Saving…' : ''}</p>
      <p role="alert">{model.saveError ?? ''}</p>
      <output aria-label="Saved profile">
        {model.saved
          ? `Saved ${model.saved.username}: ${model.saved.weeklyHours} hours per week.`
          : ''}
      </output>
    </form>
  </main>
));

export function mountProfileForm(parent: HTMLElement, service: ProfileService = demoService) {
  const source = createProfileForm(service);
  const unmount = mountView(parent, ProfileView, source);
  return {
    ...source,
    dispose: () => {
      unmount();
      source.dispose();
    },
  };
}
