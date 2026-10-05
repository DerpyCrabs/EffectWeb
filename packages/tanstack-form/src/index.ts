import { FormApi, type DeepKeys, type DeepValue } from '@tanstack/form-core';
import { Effect } from 'effect';
import type { Source } from 'effectweb';
import { projectionSource, shareValue } from 'effectweb/advanced';

export type FieldErrors<T> = Partial<Record<DeepKeys<T>, string>>;
export interface FieldState {
  readonly touched: boolean;
  /** True after an edit, until reset (TanStack's isDirty semantics). */
  readonly dirty: boolean;
  readonly error: string | undefined;
}
export interface FormSnapshot<T> {
  readonly values: T;
  readonly errors: FieldErrors<T>;
  readonly fields: Partial<Record<DeepKeys<T>, FieldState>>;
  readonly dirty: boolean;
  readonly validating: boolean;
  readonly validationError: string | undefined;
  readonly submitting: boolean;
  readonly submitted: boolean;
  readonly submitError: string | undefined;
}
export interface FormOptions<T extends object, E> {
  readonly defaultValues: T;
  readonly validate?: (values: T) => FieldErrors<T>;
  /** Runs after synchronous validation succeeds. Cancelled on edit, reset or disposal. */
  readonly validateAsync?: (values: T) => Effect.Effect<FieldErrors<T>, unknown>;
  readonly onSubmit: (values: T) => Effect.Effect<void, E>;
  readonly onError: (error: unknown) => string;
}

/** TanStack owns editable state. Only detached serializable draft data reaches EffectWeb. */
export interface FormController<T extends object> {
  readonly source: Source<FormSnapshot<T>>;
  readonly values: () => T;
  readonly setField: <K extends DeepKeys<T>>(name: K, value: DeepValue<T, K>) => void;
  readonly setTouched: <K extends DeepKeys<T>>(name: K, touched?: boolean) => void;
  /** Validate the current draft; false means invalid, cancelled, or disposed. */
  readonly validate: () => Effect.Effect<boolean>;
  readonly reset: (values?: T) => void;
  readonly submit: () => Effect.Effect<void>;
  readonly dispose: () => void;
}
export function createForm<T extends object, E = never>(
  options: FormOptions<T, E>,
): FormController<T> {
  let disposed = false;
  let submitted = false;
  let submitError: string | undefined;
  let active: AbortController | undefined;
  let validation: AbortController | undefined;
  let errors: FieldErrors<T> = {};
  let validationError: string | undefined;
  const touched = new Set<DeepKeys<T>>();
  const cancelValidation = () => {
    const previous = validation;
    validation = undefined;
    previous?.abort();
  };
  const syncErrors = () => options.validate?.(structuredClone(core.state.values)) ?? {};
  const makeCore = (defaultValues: T) =>
    new FormApi({
      onSubmitMeta: undefined as AbortController | undefined,
      defaultValues: structuredClone(defaultValues),
      onSubmit: ({ value, meta }) => {
        if (disposed || !meta || meta.signal.aborted) return;
        return Effect.runPromise(
          Effect.suspend(() => options.onSubmit(structuredClone(value))),
          { signal: meta.signal },
        );
      },
    });
  let core = makeCore(options.defaultValues);
  const source = projectionSource<FormSnapshot<T>>({
    project: () => ({
      values: structuredClone(core.state.values),
      errors: structuredClone(errors),
      fields: Object.fromEntries(
        [
          ...new Set([...touched, ...Object.keys(core.state.fieldMeta), ...Object.keys(errors)]),
        ].map((name) => {
          const key = name as DeepKeys<T>;
          return [
            name,
            {
              touched: touched.has(key),
              dirty: core.getFieldMeta(key)?.isDirty ?? false,
              error: errors[key],
            },
          ];
        }),
      ) as Partial<Record<DeepKeys<T>, FieldState>>,
      validating: validation !== undefined,
      validationError,
      dirty: core.state.isDirty,
      submitting: active !== undefined,
      submitted,
      submitError,
    }),
    reconcile: (previous, next) => shareValue<FormSnapshot<T>>(previous, next),
  });
  let unmount = core.mount();
  let subscription = core.store.subscribe(source.changed);
  source.start();
  function assertOpen() {
    if (disposed) throw new Error('Cannot update a disposed form.');
  }
  async function runValidation(signal: AbortSignal): Promise<boolean> {
    cancelValidation();
    if (disposed || signal.aborted) return false;
    const controller = new AbortController();
    validation = controller;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    validationError = undefined;
    try {
      errors = syncErrors();
      source.changed();
      if (!Object.values(errors).some(Boolean) && options.validateAsync) {
        const result = await Effect.runPromise(
          Effect.suspend(() => options.validateAsync!(structuredClone(core.state.values))),
          { signal: controller.signal },
        );
        if (disposed || validation !== controller || controller.signal.aborted) return false;
        errors = structuredClone(result);
      }
      return (
        !disposed &&
        validation === controller &&
        !controller.signal.aborted &&
        !Object.values(errors).some(Boolean)
      );
    } catch (error) {
      if (!disposed && validation === controller && !controller.signal.aborted)
        validationError = options.onError(error);
      return false;
    } finally {
      signal.removeEventListener('abort', abort);
      if (validation === controller) {
        validation = undefined;
        if (!disposed) source.changed();
      }
    }
  }
  return {
    source,
    values: (): T => structuredClone(core.state.values),
    setField<K extends DeepKeys<T>>(name: K, value: DeepValue<T, K>) {
      assertOpen();
      if (active) return;
      cancelValidation();
      validationError = undefined;
      submitError = undefined;
      core.setFieldValue(name, structuredClone(value));
      touched.add(name);
      // Async results belong to the previous draft. Recompute only local validation.
      errors = syncErrors();
      source.changed();
    },
    setTouched<K extends DeepKeys<T>>(name: K, value = true) {
      assertOpen();
      if (value) touched.add(name);
      else touched.delete(name);
      source.changed();
    },
    validate: () =>
      Effect.promise((signal) => (active ? Promise.resolve(false) : runValidation(signal))),
    reset(values?: T) {
      assertOpen();
      active?.abort();
      active = undefined;
      cancelValidation();
      errors = {};
      validationError = undefined;
      touched.clear();
      submitted = false;
      submitError = undefined;
      // Detach the old API: its pending validation/finalizers must not mutate a new draft.
      const defaults = values ?? core.options.defaultValues ?? options.defaultValues;
      subscription.unsubscribe();
      unmount();
      core = makeCore(defaults);
      unmount = core.mount();
      subscription = core.store.subscribe(source.changed);
      source.changed();
    },
    submit: (): Effect.Effect<void> =>
      Effect.promise(async (signal) => {
        if (disposed || active) return;
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) controller.abort();
        active = controller;
        submitted = true;
        submitError = undefined;
        source.changed();
        try {
          if (await runValidation(controller.signal)) {
            if (!disposed && active === controller && !controller.signal.aborted)
              await core.handleSubmit(controller);
          }
        } catch (error) {
          if (!disposed && active === controller && !controller.signal.aborted)
            submitError = options.onError(error);
        } finally {
          signal.removeEventListener('abort', abort);
          if (active === controller) {
            active = undefined;
            if (!disposed) source.changed();
          }
        }
      }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelValidation();
      active?.abort();
      subscription.unsubscribe();
      unmount();
      source.dispose();
    },
  };
}
