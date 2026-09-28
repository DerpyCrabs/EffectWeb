import { FormApi, type DeepKeys, type DeepValue } from '@tanstack/form-core';
import { Effect } from 'effect';
import { projectionSource, type Source } from 'effectweb';
import { shareValue } from 'effectweb/share';

export type FieldErrors<T> = Partial<Record<DeepKeys<T>, string>>;
export interface FormSnapshot<T> {
  readonly values: T;
  readonly errors: FieldErrors<T>;
  readonly dirty: boolean;
  readonly submitting: boolean;
  readonly submitted: boolean;
  readonly submitError: string | undefined;
}
export interface FormOptions<T extends object, E> {
  readonly defaultValues: T;
  readonly validate?: (values: T) => FieldErrors<T>;
  readonly onSubmit: (values: T) => Effect.Effect<void, E>;
  readonly onError: (error: unknown) => string;
}

/** TanStack owns editable state. Only detached serializable draft data reaches EffectWeb. */
export interface FormController<T extends object> {
  readonly source: Source<FormSnapshot<T>>;
  readonly values: () => T;
  readonly setField: <K extends DeepKeys<T>>(name: K, value: DeepValue<T, K>) => void;
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
  const makeCore = (defaultValues: T) =>
    new FormApi({
      onSubmitMeta: undefined as AbortController | undefined,
      defaultValues: structuredClone(defaultValues),
      validators: {
        onSubmit: ({ value }: { value: T }) => {
          const fields = options.validate?.(value) ?? {};
          return Object.keys(fields).length ? { fields } : undefined;
        },
      },
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
      errors: submitted ? structuredClone(options.validate?.(core.state.values) ?? {}) : {},
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
  return {
    source,
    values: (): T => structuredClone(core.state.values),
    setField<K extends DeepKeys<T>>(name: K, value: DeepValue<T, K>) {
      assertOpen();
      if (active) return;
      submitError = undefined;
      core.setFieldValue(name, structuredClone(value));
      // No FieldApi is mounted: clear old form-level field errors after edits.
      if (submitted) core.validateSync('submit');
      source.changed();
    },
    reset(values?: T) {
      assertOpen();
      active?.abort();
      active = undefined;
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
          await core.handleSubmit(controller);
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
      active?.abort();
      subscription.unsubscribe();
      unmount();
      source.dispose();
    },
  };
}
