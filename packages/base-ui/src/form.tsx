import { domBinding, observe, view } from 'effectweb';
import { createStateController, type ControllerOptions } from './controller.js';
import type { FieldHandle } from './field.js';
import type { Native } from './types.js';
/** Create a parent-owned Form handle; pass it to the root and field bindings and own its lifetime. */
export interface FormState {
  /** Messages by field name, typically from a server; cleared per field on edit. */
  readonly errors: Readonly<Record<string, string>>;
}
export interface FormOptions extends ControllerOptions, Partial<FormState> {
  readonly onClearErrors?: ((errors: Readonly<Record<string, string>>) => void) | undefined;
}
/** Create a Form handle: external field errors that focus the first invalid control and clear as the user edits. */
export const createForm = (options: FormOptions = {}) => {
  const state = createStateController<FormState>({ errors: options.errors ?? {} }, options);
  const setErrors = (errors: Readonly<Record<string, string>>) => {
    state.sync({ errors });
    options.onClearErrors?.(errors);
  };
  return Object.assign(state, {
    setErrors,
    clearError: (name: string) => {
      const { [name]: _removed, ...rest } = state.source.model().errors;
      if (name in state.source.model().errors) setErrors(rest);
    },
    clearErrors: () => {
      if (Object.keys(state.source.model().errors).length) setErrors({});
    },
  });
};
export type FormHandle = ReturnType<typeof createForm>;
const acquireErrors = (form: HTMLFormElement, current: () => FormHandle) => {
  let handle = current();
  const focusFirst = (state: FormState) => {
    // A new set of external errors focuses the first control it names.
    const name = Object.keys(state.errors).find((key) => state.errors[key]);
    const control = name && form.elements.namedItem(name);
    if (control instanceof HTMLElement && !control.contains(document.activeElement))
      control.focus();
  };
  let unsubscribe = handle.source.subscribe(focusFirst);
  return {
    update: () => {
      const next = current();
      if (next === handle) return;
      unsubscribe();
      handle = next;
      unsubscribe = handle.source.subscribe(focusFirst);
    },
    dispose: () => unsubscribe(),
  };
};
/** A native form: native validation focuses the first invalid control before submit, and external errors focus theirs. */
export const FormRoot = view<Native<'form'> & { readonly form: FormHandle }>(
  ({ form, onSubmit, ...rest }) =>
    observe(form.source, (state) => (
      <form
        {...rest}
        use={domBinding(form, acquireErrors)}
        data-invalid={Object.keys(state.errors).length ? '' : undefined}
        onSubmit={(event) => {
          const element = event.currentTarget;
          if (!element.noValidate && !element.checkValidity()) {
            event.preventDefault();
            const invalid = [...element.elements].find((control): control is HTMLInputElement =>
              control instanceof HTMLInputElement ||
              control instanceof HTMLSelectElement ||
              control instanceof HTMLTextAreaElement
                ? !control.validity.valid
                : false,
            );
            invalid?.focus();
            element.reportValidity();
            return;
          }
          onSubmit?.(event);
        }}
      />
    )),
);
/** Link a Field handle to a form error by name: the field turns invalid while the form holds an error for it, and editing the control clears it. */
export const formFieldBinding = (input: {
  readonly form: FormHandle;
  readonly field: FieldHandle;
  readonly name: string;
}) =>
  domBinding(input, (element: HTMLElement, current) => {
    const sync = () => {
      const { form, field, name } = current();
      const message = form.source.model().errors[name];
      if (message) field.sync({ invalid: true, touched: true });
    };
    const unsubscribe = current().form.source.subscribe(sync);
    const clear = () => current().form.clearError(current().name);
    element.addEventListener('input', clear);
    sync();
    return {
      update: sync,
      dispose: () => {
        unsubscribe();
        element.removeEventListener('input', clear);
      },
    };
  });
/** The message of a form error for one field, with the field's error semantics. */
export const FormFieldError = view<
  Native<'div'> & { readonly form: FormHandle; readonly field: FieldHandle; readonly name: string }
>(({ form, field, name, children, ...rest }) =>
  observe(form.source, (state) => {
    const message = state.errors[name];
    return (
      <div {...rest} id={`${field.id}-error`} role="alert" hidden={!message} data-field-error="">
        {message ?? children}
      </div>
    );
  }),
);
