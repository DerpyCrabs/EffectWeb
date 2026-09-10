import type * as Cause from 'effect/Cause';
import type * as Effect from 'effect/Effect';
import { commandSlot, effectCommand, type Transition } from './program.js';
import type { Snapshot } from './snapshot.js';
import type { EffectEventRequest } from './effectEvent.js';

type EventResult = void | boolean | EffectEventRequest;
type ValueEvent<T> = { readonly currentTarget: T };

/** Capture native values synchronously; returned Effect requests retain the listener's owner. */
export const inputText =
  (change: (value: string) => EventResult) =>
  (event: ValueEvent<{ readonly value: string }>): EventResult =>
    change(event.currentTarget.value);

export const inputChecked =
  (change: (value: boolean) => EventResult) =>
  (event: ValueEvent<{ readonly checked: boolean }>): EventResult =>
    change(event.currentTarget.checked);

/** Empty and invalid numeric inputs stay absent rather than becoming zero or NaN. */
export const inputNumber =
  (change: (value: number | undefined) => EventResult) =>
  (event: ValueEvent<{ readonly valueAsNumber: number }>): EventResult => {
    const value = event.currentTarget.valueAsNumber;
    return change(Number.isNaN(value) ? undefined : value);
  };

/** Prevention always runs during the native event, before task drop/replace policy is applied. */
export const submit =
  (run: () => EventResult) =>
  (event: Pick<SubmitEvent, 'preventDefault'>): EventResult => {
    event.preventDefault();
    return run();
  };

/** Parsing never rewrites the draft: incomplete input remains editable. */
export type FieldResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: string };

export interface FieldState<Draft, Value> {
  readonly draft: Draft;
  readonly initial: Draft;
  readonly parsed: FieldResult<Value>;
  readonly touched: boolean;
  readonly dirty: boolean;
  readonly validation: 'idle' | 'pending' | 'valid' | 'invalid';
  /** Display error; parse failures remain hidden until the configured validation event. */
  readonly error: string | undefined;
  readonly revision: number;
}

export type FieldMessage<Draft> =
  | { readonly type: 'Change'; readonly draft: Draft }
  | { readonly type: 'Blur' }
  | { readonly type: 'Validate' }
  /** A supplied draft becomes the new reset baseline. */
  | { readonly type: 'Reset'; readonly draft?: Draft }
  | { readonly type: 'Validated'; readonly revision: number; readonly error: string | undefined };

export interface FieldController<Draft, Value, R = never> {
  readonly init: (draft: Draft) => FieldState<Draft, Value>;
  readonly update: (
    model: Snapshot<FieldState<Draft, Value>>,
    message: FieldMessage<Draft>,
  ) => Transition<FieldState<Draft, Value>, FieldMessage<Draft>, R>;
}

/**
 * Immutable editable field, composed into a program/component with mapCommand.
 * Each definition owns a unique operation token. Commands inherit the program's scope;
 * edits, reset and replacement validations cancel the field's previous command.
 *
 * Parsing runs on init/change/reset. Display validation runs only on validateOn
 * (default: blur) or explicit Validate. Change clears previous display errors.
 * Async validators run only after parsing succeeds and must return an error or undefined.
 */
export function defineField<Draft extends string | boolean, Value, E = never, R = never>(options: {
  readonly id: string;
  readonly parse: (draft: Draft) => FieldResult<Value>;
  readonly validateOn?: 'change' | 'blur' | 'submit';
  readonly validate?: (
    value: Snapshot<{ value: Value }>['value'],
  ) => Effect.Effect<string | undefined, E, R>;
  readonly onFailure?: (cause: Cause.Cause<E>) => string;
}): FieldController<Draft, Value, R> {
  const slot = commandSlot(`field:${options.id}`);
  const init = (draft: Draft): FieldState<Draft, Value> => ({
    draft,
    initial: draft,
    parsed: options.parse(draft),
    touched: false,
    dirty: false,
    validation: 'idle',
    error: undefined,
    revision: 0,
  });
  const validate = (
    model: Snapshot<FieldState<Draft, Value>>,
  ): Transition<FieldState<Draft, Value>, FieldMessage<Draft>, R> => {
    const revision = model.revision + 1;
    if (!model.parsed.ok) {
      return {
        model: { ...model, revision, validation: 'invalid', error: model.parsed.error },
        cancel: [slot],
      };
    }
    const value = model.parsed.value;
    if (!options.validate) {
      return {
        model: { ...model, revision, validation: 'valid', error: undefined },
        cancel: [slot],
      };
    }
    const check = options.validate;
    return {
      model: { ...model, revision, validation: 'pending', error: undefined },
      commands: [
        effectCommand(slot, () => check(value), {
          policy: 'replace',
          onSuccess: (error): FieldMessage<Draft> => ({ type: 'Validated', revision, error }),
          onFailure: (cause): FieldMessage<Draft> => ({
            type: 'Validated',
            revision,
            error: options.onFailure?.(cause) ?? 'Validation is unavailable. Try again.',
          }),
        }),
      ],
    };
  };
  return {
    init,
    update(model, message) {
      switch (message.type) {
        case 'Change': {
          const next: Snapshot<FieldState<Draft, Value>> = {
            ...model,
            // Drafts are primitive; freshly parsed data is published through the owner's guard.
            draft: message.draft as Snapshot<FieldState<Draft, Value>>['draft'],
            parsed: options.parse(message.draft) as Snapshot<FieldState<Draft, Value>>['parsed'],
            dirty: !Object.is(message.draft, model.initial),
            revision: model.revision + 1,
            validation: 'idle',
            error: undefined,
          };
          return options.validateOn === 'change' ? validate(next) : { model: next, cancel: [slot] };
        }
        case 'Blur': {
          const next = { ...model, touched: true };
          return (options.validateOn ?? 'blur') === 'blur' ? validate(next) : { model: next };
        }
        case 'Validate':
          return validate({ ...model, touched: true });
        case 'Reset':
          return {
            model: {
              ...init(message.draft ?? (model.initial as Draft)),
              revision: model.revision + 1,
            },
            cancel: [slot],
          };
        case 'Validated':
          return message.revision === model.revision && model.validation === 'pending'
            ? {
                model: {
                  ...model,
                  validation: message.error === undefined ? 'valid' : 'invalid',
                  error: message.error,
                },
              }
            : { model };
      }
    },
  };
}
