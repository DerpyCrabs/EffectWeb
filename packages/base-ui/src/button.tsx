import { view } from 'effectweb';
import type { Native } from './types.js';
/** Native button with optional focus retention when disabled. */
export const Button = view<Native<'button'> & { focusableWhenDisabled?: boolean }>(
  ({ type = 'button', disabled, focusableWhenDisabled, onClick, ...props }) => (
    <button
      {...props}
      type={type}
      disabled={disabled && !focusableWhenDisabled}
      aria-disabled={(disabled && focusableWhenDisabled) || props['aria-disabled']}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        return onClick?.(event);
      }}
    />
  ),
);
