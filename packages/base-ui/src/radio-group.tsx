import { formControlBinding } from './form-reset.js';
import { observe, view } from 'effectweb';
import { createValueController, type ValueOptions, type ValueState } from './controller.js';
import { rove, rovingBinding } from './collection.js';
import type { Native } from './types.js';
/** Create a parent-owned RadioGroup handle; pass it to the parts and own its lifetime. */
export interface RadioGroupState extends ValueState {}
export interface RadioGroupOptions extends ValueOptions {}
/** Create a RadioGroup handle: the selected value, orientation and disabled state, shared by the items. */
export const createRadioGroup = (options: RadioGroupOptions = {}) => createValueController(options);
export type RadioGroupHandle = ReturnType<typeof createRadioGroup>;
/** The `radiogroup` container; publishes orientation and disabled state. */
export const RadioGroupRoot = view<Native<'div'> & { readonly radioGroup: RadioGroupHandle }>(
  ({ radioGroup, onKeyDown, ...rest }) =>
    observe(radioGroup.source, () => (
      <div
        {...rest}
        use={rovingBinding('[data-group-item]')}
        role="radiogroup"
        aria-orientation={radioGroup.orientation}
        data-orientation={radioGroup.orientation}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented)
            rove(event, event.currentTarget, '[data-group-item]', radioGroup.orientation, true);
        }}
      />
    )),
);
/** A button radio selected when its `value` matches the handle; roving focus moves between items. */
export const RadioGroupItem = view<
  Native<'button'> & { readonly radioGroup: RadioGroupHandle; readonly value: string }
>(({ radioGroup, value, children, onClick, ...rest }) =>
  observe(radioGroup.source, (state) => (
    <button
      {...rest}
      type="button"
      role="radio"
      data-group-item=""
      disabled={state.disabled || rest.disabled}
      aria-checked={state.value === value}
      tabindex={state.value === '' || state.value === value ? 0 : -1}
      data-checked={state.value === value ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) radioGroup.setValue(value);
      }}
    >
      {children}
    </button>
  )),
);
/** Native form-participating radio alternative to the button part. */
export const RadioInput = view<
  Native<'input'> & { readonly radioGroup: RadioGroupHandle; readonly value: string }
>(({ radioGroup, value, onChange, ...rest }) =>
  observe(radioGroup.source, (state) => (
    <input
      {...rest}
      type="radio"
      use={formControlBinding(radioGroup)}
      name={rest.name ?? radioGroup.id}
      value={value}
      checked={state.value === value}
      disabled={state.disabled || rest.disabled}
      data-checked={state.value === value ? '' : undefined}
      onChange={(event) => {
        onChange?.(event);
        if (!event.defaultPrevented) radioGroup.setValue(value);
      }}
    />
  )),
);
