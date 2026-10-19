import { formControlBinding } from './form-reset.js';
import { observe, view } from 'effectweb';
import { createCheckedController, type CheckedOptions, type CheckedState } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Switch handle; pass it to the parts and own its lifetime. */
export interface SwitchState extends CheckedState {}
export interface SwitchOptions extends CheckedOptions {}
/** Create a Switch handle: the checked state with setChecked, shared by the root, indicator and thumb. */
export const createSwitch = (options: SwitchOptions = {}) => createCheckedController(options);
export type SwitchHandle = ReturnType<typeof createSwitch>;
/** A native checkbox with `role='switch'` bound to the handle. */
export const SwitchRoot = view<Native<'input'> & { readonly switch: SwitchHandle }>(
  ({ switch: switchControl, onChange, ...rest }) =>
    observe(switchControl.source, (state) => (
      <input
        {...rest}
        type="checkbox"
        role="switch"
        checked={state.checked}
        disabled={state.disabled || rest.disabled}
        aria-checked={state.indeterminate ? 'mixed' : state.checked}
        use={formControlBinding(switchControl, state.indeterminate)}
        data-checked={state.checked ? '' : undefined}
        data-unchecked={!state.checked ? '' : undefined}
        data-indeterminate={state.indeterminate ? '' : undefined}
        data-disabled={state.disabled || rest.disabled ? '' : undefined}
        onChange={(event) => {
          onChange?.(event);
          if (!event.defaultPrevented) switchControl.setChecked(event.currentTarget.checked);
          // A controlled request can leave the model unchanged while native activation toggles.
          const accepted = switchControl.source.model();
          event.currentTarget.checked = accepted.checked;
          event.currentTarget.indeterminate = accepted.indeterminate;
        }}
      />
    )),
);
/** An element shown while the switch is on. */
export const SwitchIndicator = view<Native<'span'> & { readonly switch: SwitchHandle }>(
  ({ switch: switchControl, ...rest }) =>
    observe(switchControl.source, (state) => (
      <span
        {...rest}
        aria-hidden="true"
        hidden={!state.checked && !state.indeterminate}
        data-checked={state.checked ? '' : undefined}
      />
    )),
);
/** The moving thumb of a switch. */
export const SwitchThumb = view<Native<'span'> & { readonly switch: SwitchHandle }>(
  ({ switch: control, ...rest }) =>
    observe(control.source, (state) => (
      <span
        {...rest}
        aria-hidden="true"
        data-checked={state.checked ? '' : undefined}
        data-unchecked={!state.checked ? '' : undefined}
      />
    )),
);
