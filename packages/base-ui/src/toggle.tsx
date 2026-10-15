import { observe, view } from 'effectweb';
import { createCheckedController, type CheckedOptions, type CheckedState } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Toggle handle; pass it to the parts and own its lifetime. */
export interface ToggleState extends CheckedState {}
export interface ToggleOptions extends CheckedOptions {}
/** Create a Toggle handle: the pressed state, shared by the toggle and its indicator. */
export const createToggle = (options: ToggleOptions = {}) => createCheckedController(options);
export type ToggleHandle = ReturnType<typeof createToggle>;
/** A button with a pressed state bound to the handle. */
export const Toggle = view<Native<'button'> & { readonly toggle: ToggleHandle }>(
  ({ toggle, onClick, children, ...rest }) =>
    observe(toggle.source, (state) => (
      <button
        {...rest}
        type="button"
        disabled={state.disabled || rest.disabled}
        aria-pressed={state.checked}
        data-pressed={state.checked ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) toggle.setChecked(!state.checked);
        }}
      >
        {children}
      </button>
    )),
);
/** An element shown while the toggle is pressed. */
export const ToggleIndicator = view<Native<'span'> & { readonly toggle: ToggleHandle }>(
  ({ toggle, ...rest }) =>
    observe(toggle.source, (state) => (
      <span
        {...rest}
        aria-hidden="true"
        hidden={!state.checked && !state.indeterminate}
        data-checked={state.checked ? '' : undefined}
      />
    )),
);
