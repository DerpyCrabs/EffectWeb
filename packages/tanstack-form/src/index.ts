import {
  FieldApi,
  FormApi,
  type AnyFieldLikeMetaBase,
  type AnyFieldMeta,
  type DeepKeys,
  type DeepValue,
  type FieldAsyncValidateOrFn,
  type FieldListeners,
  type FieldValidateOrFn,
  type FieldValidators,
  type FormAsyncValidateOrFn,
  type FormListeners,
  type FormValidateOrFn,
  type FormValidators,
  type UpdateMetaOptions,
  type Updater,
  type ValidationCause,
  type ValidationErrorMap,
  type ValidationLogicFn,
} from '@tanstack/form-core';
import * as Effect from 'effect/Effect';
import type { Source } from 'effectweb';
import { projectionSource, shareValue } from 'effectweb/advanced';

/** Draft paths and their value types, for typed field bindings. */
export type {
  DeepKeys,
  DeepValue,
  ValidationCause,
  AnyFieldMeta as FieldMeta,
  UpdateMetaOptions,
} from '@tanstack/form-core';

type Sync<T> = FormValidateOrFn<T> | undefined;
type Async<T> = FormAsyncValidateOrFn<T> | undefined;
type Api<T, M> = FormApi<
  T,
  Sync<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Async<T>,
  M
>;
/** The form validators of TanStack Form Core: a function or a Standard Schema per cause. */
export type FormValidatorOptions<T> = FormValidators<
  T,
  Sync<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>
>;
/** The form listeners of TanStack Form Core, called after changes, blur, mount and submit. */
export type FormListenerOptions<T, M = never> = FormListeners<
  T,
  Sync<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Sync<T>,
  Async<T>,
  Async<T>,
  M
>;

/** The published form state: TanStack's state without its abort controllers. */
export interface FormSnapshot<T> {
  readonly values: T;
  /** Every current error, flattened. */
  readonly errors: readonly unknown[];
  readonly errorMap: ValidationErrorMap;
  /** Per-field meta for every field that was touched, validated or registered. */
  readonly fieldMeta: Partial<Record<DeepKeys<T>, AnyFieldMeta>>;
  readonly isValid: boolean;
  readonly isFieldsValid: boolean;
  readonly isValidating: boolean;
  readonly isFieldsValidating: boolean;
  readonly isDirty: boolean;
  readonly isPristine: boolean;
  readonly isTouched: boolean;
  readonly isBlurred: boolean;
  readonly isDefaultValue: boolean;
  readonly canSubmit: boolean;
  readonly isSubmitting: boolean;
  readonly isSubmitted: boolean;
  readonly isSubmitSuccessful: boolean;
  readonly submissionAttempts: number;
  /** The message of the last failed submission, until the next edit, reset or submission. */
  readonly submitError: string | undefined;
}
export interface FormOptions<T extends object, M = never> {
  readonly defaultValues: T;
  readonly formId?: string | undefined;
  readonly validators?: FormValidatorOptions<T> | undefined;
  readonly listeners?: FormListenerOptions<T, M> | undefined;
  readonly validationLogic?: ValidationLogicFn | undefined;
  readonly asyncAlways?: boolean | undefined;
  readonly asyncDebounceMs?: number | undefined;
  readonly canSubmitWhenInvalid?: boolean | undefined;
  readonly onSubmitMeta?: M | undefined;
  /** Runs after every validator passed. An Effect is interrupted when the submission is. */
  readonly onSubmit?:
    | ((props: {
        readonly value: T;
        readonly meta: M;
      }) => void | Promise<unknown> | Effect.Effect<unknown, unknown>)
    | undefined;
  readonly onSubmitInvalid?: ((props: { readonly value: T; readonly meta: M }) => void) | undefined;
  /** Turn a submission failure into `submitError`. Defaults to the error message. */
  readonly onError?: ((error: unknown) => string) | undefined;
}

/** TanStack owns the editable state; EffectWeb publishes detached snapshots of it. */
export interface FormController<T extends object, M = never> {
  readonly source: Source<FormSnapshot<T>>;
  /** The TanStack Form API for what the controller does not wrap. Treat its state as read-only. */
  readonly api: Api<T, M>;
  readonly values: () => T;
  readonly getFieldValue: <K extends DeepKeys<T>>(name: K) => DeepValue<T, K>;
  readonly getFieldMeta: <K extends DeepKeys<T>>(name: K) => AnyFieldMeta | undefined;
  readonly setFieldValue: <K extends DeepKeys<T>>(
    name: K,
    value: Updater<DeepValue<T, K>>,
    options?: UpdateMetaOptions,
  ) => void;
  readonly setFieldMeta: <K extends DeepKeys<T>>(
    name: K,
    updater: Updater<AnyFieldLikeMetaBase>,
  ) => void;
  /** Set a value and run the form's change validators, as a field's `handleChange` would. */
  readonly handleChange: <K extends DeepKeys<T>>(name: K, value: DeepValue<T, K>) => void;
  /** Mark a field blurred and touched and run the form's blur validators. */
  readonly handleBlur: <K extends DeepKeys<T>>(name: K) => void;
  readonly deleteField: <K extends DeepKeys<T>>(name: K) => void;
  readonly resetField: <K extends DeepKeys<T>>(name: K) => void;
  readonly pushFieldValue: <K extends DeepKeys<T>>(
    name: K,
    value: DeepValue<T, K> extends readonly (infer Item)[] ? Item : never,
    options?: UpdateMetaOptions,
  ) => void;
  readonly insertFieldValue: <K extends DeepKeys<T>>(
    name: K,
    index: number,
    value: DeepValue<T, K> extends readonly (infer Item)[] ? Item : never,
    options?: UpdateMetaOptions,
  ) => Promise<void>;
  readonly replaceFieldValue: <K extends DeepKeys<T>>(
    name: K,
    index: number,
    value: DeepValue<T, K> extends readonly (infer Item)[] ? Item : never,
    options?: UpdateMetaOptions,
  ) => Promise<void>;
  readonly removeFieldValue: <K extends DeepKeys<T>>(
    name: K,
    index: number,
    options?: UpdateMetaOptions,
  ) => Promise<void>;
  readonly swapFieldValues: <K extends DeepKeys<T>>(
    name: K,
    first: number,
    second: number,
    options?: UpdateMetaOptions,
  ) => void;
  readonly moveFieldValues: <K extends DeepKeys<T>>(
    name: K,
    from: number,
    to: number,
    options?: UpdateMetaOptions,
  ) => void;
  readonly clearFieldValues: <K extends DeepKeys<T>>(name: K, options?: UpdateMetaOptions) => void;
  /** Run the form validators for a cause; resolves to whether the form is valid. */
  readonly validate: (cause?: ValidationCause) => Effect.Effect<boolean>;
  /** Run every mounted field's validators for a cause. */
  readonly validateAllFields: (cause?: ValidationCause) => Effect.Effect<boolean>;
  readonly reset: (values?: T, options?: { readonly keepDefaultValues?: boolean }) => void;
  /** Validate and submit once; a submission already running is kept and this one dropped. */
  readonly submit: (meta?: M) => Effect.Effect<void>;
  readonly update: (options: Partial<FormOptions<T, M>>) => void;
  readonly dispose: () => void;
}

interface PlainField {
  readonly mount: () => () => void;
  readonly handleChange: (value: unknown) => void;
  readonly handleBlur: () => void;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Non-serializable TanStack internals that must not reach a snapshot. */
const snapshot = <T extends object, M>(
  core: Api<T, M>,
  submitError: string | undefined,
): FormSnapshot<T> => {
  const state = core.state;
  return {
    values: state.values,
    errors: state.errors as readonly unknown[],
    errorMap: state.errorMap as ValidationErrorMap,
    fieldMeta: state.fieldMeta as Partial<Record<DeepKeys<T>, AnyFieldMeta>>,
    isValid: state.isValid,
    isFieldsValid: state.isFieldsValid,
    isValidating: state.isValidating,
    isFieldsValidating: state.isFieldsValidating,
    isDirty: state.isDirty,
    isPristine: state.isPristine,
    isTouched: state.isTouched,
    isBlurred: state.isBlurred,
    isDefaultValue: state.isDefaultValue,
    canSubmit: state.canSubmit,
    isSubmitting: state.isSubmitting,
    isSubmitted: state.isSubmitted,
    isSubmitSuccessful: state.isSubmitSuccessful,
    submissionAttempts: state.submissionAttempts,
    submitError,
  };
};

export function createForm<T extends object, M = never>(
  options: FormOptions<T, M>,
): FormController<T, M> {
  let disposed = false;
  let active: AbortController | undefined;
  let submitError: string | undefined;
  const toError = options.onError ?? message;
  const coreOptions = ({
    defaultValues,
    onSubmit,
    onSubmitInvalid,
    onError: _onError,
    ...rest
  }: Partial<FormOptions<T, M>>) => ({
    ...rest,
    ...(defaultValues === undefined ? {} : { defaultValues: structuredClone(defaultValues) }),
    ...(onSubmit === undefined
      ? {}
      : {
          onSubmit: ({ value, meta }: { value: T; meta: M }) => {
            const outcome = onSubmit({ value: structuredClone(value), meta });
            if (!Effect.isEffect(outcome)) return outcome;
            const signal = active?.signal;
            return Effect.runPromise(outcome, signal ? { signal } : undefined);
          },
        }),
    ...(onSubmitInvalid === undefined
      ? {}
      : {
          onSubmitInvalid: ({ value, meta }: { value: T; meta: M }) =>
            onSubmitInvalid({ value: structuredClone(value), meta }),
        }),
  });
  const core = new FormApi(coreOptions(options) as never) as Api<T, M>;
  const source = projectionSource<FormSnapshot<T>>({
    project: () => structuredClone(snapshot(core, submitError)),
    reconcile: (previous, next) => shareValue<FormSnapshot<T>>(previous, next),
  });
  const unmount = core.mount();
  const subscription = core.store.subscribe(source.changed);
  source.start();
  const assertOpen = () => {
    if (disposed) throw new Error('Cannot update a disposed form.');
  };
  // TanStack clears submit errors and fires listeners from a field instance, so form-level
  // change and blur handling goes through one mounted plain field per name.
  const fields = new Map<string, { readonly api: PlainField; readonly unmount: () => void }>();
  const fieldFor = (name: DeepKeys<T>) => {
    let entry = fields.get(name);
    if (!entry) {
      const api = new FieldApi({ form: core, name } as never) as unknown as PlainField;
      entry = { api, unmount: api.mount() };
      fields.set(name, entry);
    }
    return entry.api;
  };
  const clearSubmitError = () => {
    if (submitError !== undefined) {
      submitError = undefined;
      source.changed();
    }
  };
  const controller: FormController<T, M> = {
    source,
    api: core,
    values: () => structuredClone(core.state.values),
    getFieldValue: (name) => structuredClone(core.getFieldValue(name)),
    getFieldMeta: (name) => {
      const meta = core.getFieldMeta(name);
      return meta && structuredClone(meta);
    },
    setFieldValue<K extends DeepKeys<T>>(
      name: K,
      value: Updater<DeepValue<T, K>>,
      updateOptions?: UpdateMetaOptions,
    ) {
      assertOpen();
      clearSubmitError();
      const detached: Updater<DeepValue<T, K>> =
        typeof value === 'function'
          ? (previous: DeepValue<T, K>) =>
              structuredClone((value as (previous: DeepValue<T, K>) => DeepValue<T, K>)(previous))
          : structuredClone(value);
      core.setFieldValue(name, detached, updateOptions);
    },
    setFieldMeta(name, updater) {
      assertOpen();
      core.setFieldMeta(name, updater);
    },
    handleChange(name, value) {
      assertOpen();
      clearSubmitError();
      fieldFor(name).handleChange(structuredClone(value));
    },
    handleBlur(name) {
      assertOpen();
      fieldFor(name).handleBlur();
    },
    deleteField: (name) => core.deleteField(name),
    resetField: (name) => core.resetField(name),
    pushFieldValue: (name, value, updateOptions) =>
      core.pushFieldValue(name, structuredClone(value) as never, updateOptions),
    insertFieldValue: (name, index, value, updateOptions) =>
      core.insertFieldValue(name, index, structuredClone(value) as never, updateOptions),
    replaceFieldValue: (name, index, value, updateOptions) =>
      core.replaceFieldValue(name, index, structuredClone(value) as never, updateOptions),
    removeFieldValue: (name, index, updateOptions) =>
      core.removeFieldValue(name, index, updateOptions),
    swapFieldValues: (name, first, second, updateOptions) =>
      core.swapFieldValues(name, first, second, updateOptions),
    moveFieldValues: (name, from, to, updateOptions) =>
      core.moveFieldValues(name, from, to, updateOptions),
    clearFieldValues: (name, updateOptions) => core.clearFieldValues(name, updateOptions),
    validate: (cause = 'submit') =>
      Effect.promise(async () => {
        if (disposed) return false;
        await core.validate(cause);
        return !disposed && core.state.isValid;
      }),
    validateAllFields: (cause = 'submit') =>
      Effect.promise(async () => {
        if (disposed) return false;
        await core.validateAllFields(cause);
        return !disposed && core.state.isFieldsValid;
      }),
    reset(values, resetOptions) {
      assertOpen();
      active?.abort();
      active = undefined;
      submitError = undefined;
      core.reset(values === undefined ? undefined : structuredClone(values), resetOptions);
      source.changed();
    },
    submit: (meta) =>
      Effect.promise(async (signal) => {
        if (disposed || active) return;
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) controller.abort();
        active = controller;
        submitError = undefined;
        source.changed();
        try {
          if (!controller.signal.aborted) await core.handleSubmit(meta as never);
        } catch (error) {
          if (!disposed && active === controller && !controller.signal.aborted)
            submitError = toError(error);
        } finally {
          signal.removeEventListener('abort', abort);
          if (active === controller) {
            active = undefined;
            if (!disposed) source.changed();
          }
        }
      }),
    update(next) {
      assertOpen();
      core.update({ ...core.options, ...coreOptions(next) } as never);
      source.changed();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active?.abort();
      subscription.unsubscribe();
      for (const entry of fields.values()) entry.unmount();
      fields.clear();
      unmount();
      source.dispose();
    },
  };
  return controller;
}

type FieldSync<T, K extends DeepKeys<T>> = FieldValidateOrFn<T, K, DeepValue<T, K>> | undefined;
type FieldAsync<T, K extends DeepKeys<T>> =
  | FieldAsyncValidateOrFn<T, K, DeepValue<T, K>>
  | undefined;
/** The field validators of TanStack Form Core, run with the form's validators of the same cause. */
export type FieldValidatorOptions<T, K extends DeepKeys<T>> = FieldValidators<
  T,
  K,
  DeepValue<T, K>,
  FieldSync<T, K>,
  FieldSync<T, K>,
  FieldAsync<T, K>,
  FieldSync<T, K>,
  FieldAsync<T, K>,
  FieldSync<T, K>,
  FieldAsync<T, K>,
  FieldSync<T, K>,
  FieldAsync<T, K>
>;
export interface FieldOptions<T extends object, K extends DeepKeys<T>> {
  readonly name: K;
  readonly validators?: FieldValidatorOptions<T, K> | undefined;
  readonly listeners?: FieldListeners<T, K, DeepValue<T, K>> | undefined;
  readonly validationLogic?: ValidationLogicFn | undefined;
  readonly asyncAlways?: boolean | undefined;
  readonly asyncDebounceMs?: number | undefined;
  readonly defaultValue?: DeepValue<T, K> | undefined;
  readonly defaultMeta?: Partial<AnyFieldMeta> | undefined;
  readonly disableErrorFlat?: boolean | undefined;
}
/** The published state of one field: its value and TanStack's meta. */
export interface FieldSnapshot<V> {
  readonly value: V;
  readonly meta: AnyFieldMeta;
}
/** A mounted field: its validators and listeners run with the form's; dispose it with its view. */
export interface FieldController<V> {
  readonly source: Source<FieldSnapshot<V>>;
  readonly name: string;
  readonly getValue: () => V;
  readonly setValue: (value: Updater<V>, options?: UpdateMetaOptions) => void;
  /** Set the value and run the change validators. */
  readonly handleChange: (value: Updater<V>) => void;
  /** Mark the field blurred and run the blur validators. */
  readonly handleBlur: () => void;
  readonly setMeta: (updater: Updater<AnyFieldLikeMetaBase>) => void;
  readonly validate: (cause: ValidationCause) => Effect.Effect<readonly unknown[]>;
  readonly pushValue: (
    value: V extends readonly (infer Item)[] ? Item : never,
    options?: UpdateMetaOptions,
  ) => void;
  readonly insertValue: (
    index: number,
    value: V extends readonly (infer Item)[] ? Item : never,
    options?: UpdateMetaOptions,
  ) => void;
  readonly replaceValue: (
    index: number,
    value: V extends readonly (infer Item)[] ? Item : never,
    options?: UpdateMetaOptions,
  ) => void;
  readonly removeValue: (index: number, options?: UpdateMetaOptions) => void;
  readonly swapValues: (first: number, second: number, options?: UpdateMetaOptions) => void;
  readonly moveValue: (from: number, to: number, options?: UpdateMetaOptions) => void;
  readonly clearValues: (options?: UpdateMetaOptions) => void;
  readonly dispose: () => void;
}
/**
 * Mount a field of a form: the counterpart of TanStack's `useField`. Field validators run
 * with the form's validators of the same cause, and the field's meta joins the form snapshot.
 */
export function createField<T extends object, K extends DeepKeys<T>, M = never>(
  form: FormController<T, M>,
  options: FieldOptions<T, K>,
): FieldController<DeepValue<T, K>> {
  type V = DeepValue<T, K>;
  let disposed = false;
  const field = new FieldApi({
    form: form.api,
    ...options,
    ...(options.defaultValue === undefined
      ? {}
      : { defaultValue: structuredClone(options.defaultValue) }),
  } as never) as FieldApi<
    T,
    K,
    V,
    FieldSync<T, K>,
    FieldSync<T, K>,
    FieldAsync<T, K>,
    FieldSync<T, K>,
    FieldAsync<T, K>,
    FieldSync<T, K>,
    FieldAsync<T, K>,
    FieldSync<T, K>,
    FieldAsync<T, K>,
    Sync<T>,
    Sync<T>,
    Async<T>,
    Sync<T>,
    Async<T>,
    Sync<T>,
    Async<T>,
    Sync<T>,
    Async<T>,
    Async<T>,
    M
  >;
  const source = projectionSource<FieldSnapshot<V>>({
    project: () => structuredClone({ value: field.state.value, meta: field.state.meta }),
    reconcile: (previous, next) => shareValue<FieldSnapshot<V>>(previous, next),
  });
  const unmount = field.mount();
  const subscription = field.store.subscribe(source.changed);
  source.start();
  const assertOpen = () => {
    if (disposed) throw new Error('Cannot update a disposed field.');
  };
  const detached = (value: Updater<V>): Updater<V> =>
    typeof value === 'function'
      ? (previous: V) => structuredClone((value as (previous: V) => V)(previous))
      : structuredClone(value);
  return {
    source,
    name: options.name,
    getValue: () => structuredClone(field.getValue()),
    setValue(value, updateOptions) {
      assertOpen();
      field.setValue(detached(value), updateOptions);
    },
    handleChange(value) {
      assertOpen();
      field.handleChange(detached(value));
    },
    handleBlur() {
      assertOpen();
      field.handleBlur();
    },
    setMeta: (updater) => field.setMeta(updater as never),
    validate: (cause) =>
      Effect.promise(async () => (disposed ? [] : ((await field.validate(cause)) as unknown[]))),
    pushValue: (value, updateOptions) =>
      field.pushValue(structuredClone(value) as never, updateOptions),
    insertValue: (index, value, updateOptions) =>
      field.insertValue(index, structuredClone(value) as never, updateOptions),
    replaceValue: (index, value, updateOptions) =>
      field.replaceValue(index, structuredClone(value) as never, updateOptions),
    removeValue: (index, updateOptions) => field.removeValue(index, updateOptions),
    swapValues: (first, second, updateOptions) => field.swapValues(first, second, updateOptions),
    moveValue: (from, to, updateOptions) => field.moveValue(from, to, updateOptions),
    clearValues: (updateOptions) => field.clearValues(updateOptions),
    dispose() {
      if (disposed) return;
      disposed = true;
      subscription.unsubscribe();
      unmount();
      source.dispose();
    },
  };
}
