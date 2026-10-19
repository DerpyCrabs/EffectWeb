import { formControlBinding } from './form-reset.js';
import { observe, view } from 'effectweb';
import { createCheckedController, type CheckedOptions, type CheckedState } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Checkbox handle; pass it to the parts and own its lifetime. */
export interface CheckboxState extends CheckedState {}
export interface CheckboxOptions extends CheckedOptions {}
/** Create a Checkbox handle: checked and indeterminate state with setChecked, shared by the root and indicator. */
export const createCheckbox = (options: CheckboxOptions = {}) => createCheckedController(options);
export type CheckboxHandle = ReturnType<typeof createCheckbox>;
/** A native checkbox input bound to the handle; supports the indeterminate property and form reset. */
export const CheckboxRoot = view<Native<'input'> & { readonly checkbox: CheckboxHandle }>(
  ({ checkbox, onChange, ...rest }) =>
    observe(checkbox.source, (state) => (
      <input
        {...rest}
        type="checkbox"
        checked={state.checked}
        disabled={state.disabled || rest.disabled}
        aria-checked={state.indeterminate ? 'mixed' : state.checked}
        use={formControlBinding(checkbox, state.indeterminate)}
        data-checked={state.checked ? '' : undefined}
        data-unchecked={!state.checked && !state.indeterminate ? '' : undefined}
        data-indeterminate={state.indeterminate ? '' : undefined}
        data-disabled={state.disabled || rest.disabled ? '' : undefined}
        onChange={(event) => {
          onChange?.(event);
          if (!event.defaultPrevented) checkbox.setChecked(event.currentTarget.checked);
          // A controlled request can leave the model unchanged while native activation toggles.
          const accepted = checkbox.source.model();
          event.currentTarget.checked = accepted.checked;
          event.currentTarget.indeterminate = accepted.indeterminate;
        }}
      />
    )),
);
/** An element shown while the checkbox is checked or indeterminate. */
export const CheckboxIndicator = view<Native<'span'> & { readonly checkbox: CheckboxHandle }>(
  ({ checkbox, ...rest }) =>
    observe(checkbox.source, (state) => (
      <span
        {...rest}
        aria-hidden="true"
        hidden={!state.checked && !state.indeterminate}
        data-checked={state.checked ? '' : undefined}
      />
    )),
);
