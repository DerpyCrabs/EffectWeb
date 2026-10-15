import { domBinding, observe, view } from 'effectweb';
import { createStateController, type ControllerOptions } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Field handle; pass it to the parts and own its lifetime. */
export interface FieldState {
  readonly descriptionIds: readonly string[];
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly touched: boolean;
  readonly dirty: boolean;
}
export interface FieldOptions
  extends ControllerOptions, Partial<Omit<FieldState, 'descriptionIds'>> {}
/** Create a Field handle: disabled, invalid, touched and dirty flags and the ids that link label, control, description and error. */
export const createField = (options: FieldOptions = {}) => {
  const control = createStateController<FieldState>(
    {
      descriptionIds: [],
      disabled: options.disabled ?? false,
      invalid: options.invalid ?? false,
      touched: options.touched ?? false,
      dirty: options.dirty ?? false,
    },
    options,
  );
  const mounted = new Map<string, number>();
  const publish = () => control.sync({ descriptionIds: [...mounted.keys()] });
  return Object.assign(control, {
    describe: (id: string) => {
      mounted.set(id, (mounted.get(id) ?? 0) + 1);
      publish();
      return () => {
        const count = mounted.get(id) ?? 0;
        if (count > 1) mounted.set(id, count - 1);
        else mounted.delete(id);
        publish();
      };
    },
  });
};
export type FieldHandle = ReturnType<typeof createField>;
const acquireDescription = (
  _element: HTMLElement,
  current: () => { field: FieldHandle; id: string },
) => {
  let input = current();
  let stop = input.field.describe(input.id);
  return {
    update: () => {
      const next = current();
      if (input.field !== next.field || input.id !== next.id) {
        stop();
        input = next;
        stop = input.field.describe(input.id);
      }
    },
    dispose: () => stop(),
  };
};
/** The field container; publishes disabled, invalid, touched and dirty attributes. */
export const FieldRoot = view<Native<'div'> & { readonly field: FieldHandle }>(
  ({ field, ...rest }) =>
    observe(field.source, (state) => (
      <div
        {...rest}
        role="group"
        data-invalid={state.invalid ? '' : undefined}
        data-valid={!state.invalid ? '' : undefined}
        data-touched={state.touched ? '' : undefined}
        data-dirty={state.dirty ? '' : undefined}
        data-disabled={state.disabled ? '' : undefined}
      />
    )),
);
/** The label of a field, associated with its control through handle ids. */
export const FieldLabel = view<Native<'label'> & { readonly field: FieldHandle }>(
  ({ field, ...rest }) => <label {...rest} for={`${field.id}-control`} />,
);
/** Supporting text for a field, referenced by the control through `aria-describedby`. */
export const FieldDescription = view<Native<'p'> & { readonly field: FieldHandle }>(
  ({ field, ...rest }) => (
    <p
      {...rest}
      id={`${field.id}-description`}
      use={domBinding({ field, id: `${field.id}-description` }, acquireDescription)}
    />
  ),
);
/** The error text of a field, shown while the field is invalid. */
export const FieldError = view<Native<'div'> & { readonly field: FieldHandle }>(
  ({ field, ...rest }) =>
    observe(field.source, (state) => (
      <div
        {...rest}
        id={`${field.id}-error`}
        role="alert"
        hidden={!state.invalid}
        use={domBinding({ field, id: `${field.id}-error` }, acquireDescription)}
      />
    )),
);
/** The input of a field; native validity feeds the handle, and mounted description and error parts are linked through `aria-describedby`. */
export const FieldControl = view<Native<'input'> & { readonly field: FieldHandle }>(
  ({ field, onInput, onBlur, onInvalid, ...rest }) =>
    observe(field.source, (state) => (
      <input
        {...rest}
        id={`${field.id}-control`}
        disabled={state.disabled || rest.disabled}
        aria-invalid={state.invalid}
        aria-describedby={
          [
            ...new Set([
              ...String(rest['aria-describedby'] ?? '')
                .split(/\s+/)
                .filter(Boolean),
              ...state.descriptionIds,
            ]),
          ].join(' ') || undefined
        }
        data-invalid={state.invalid ? '' : undefined}
        onInput={(event) => {
          onInput?.(event);
          if (event.defaultPrevented) return;
          field.sync({ dirty: true, invalid: !event.currentTarget.validity.valid });
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (event.defaultPrevented) return;
          field.sync({ touched: true, invalid: !event.currentTarget.validity.valid });
        }}
        onInvalid={(event) => {
          onInvalid?.(event);
          if (event.defaultPrevented) return;
          field.sync({ invalid: true });
        }}
      />
    )),
);

/** Stateless field layout for controlled form adapters; stateful controls use FieldRoot. */
export const FieldLayout = view<
  Native<'div'> & {
    readonly invalid?: boolean | undefined;
    readonly disabled?: boolean | undefined;
  }
>(({ invalid, disabled, ...rest }) => (
  <div
    {...rest}
    role="group"
    data-invalid={invalid ? 'true' : undefined}
    data-disabled={disabled ? 'true' : undefined}
    data-valid={!invalid ? '' : undefined}
  />
));
