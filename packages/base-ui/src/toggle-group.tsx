import { observe, view } from 'effectweb';
import { createValuesController, type ValuesOptions, type ValuesState } from './controller.js';
import { rove, rovingBinding } from './collection.js';
import type { Native } from './types.js';
/** Create a parent-owned ToggleGroup handle; pass it to the parts and own its lifetime. */
export interface ToggleGroupState extends ValuesState {}
export interface ToggleGroupOptions extends ValuesOptions {}
/** Create a ToggleGroup handle: the pressed values and whether several may be pressed, shared by the items. */
export const createToggleGroup = (options: ToggleGroupOptions = {}) =>
  createValuesController(options);
export type ToggleGroupHandle = ReturnType<typeof createToggleGroup>;
/** The toggle group container; publishes orientation and moves focus between items. */
export const ToggleGroupRoot = view<Native<'div'> & { readonly toggleGroup: ToggleGroupHandle }>(
  ({ toggleGroup, onKeyDown, ...rest }) =>
    observe(toggleGroup.source, () => (
      <div
        {...rest}
        use={rovingBinding('[data-group-item]')}
        role="group"
        aria-orientation={toggleGroup.orientation}
        data-orientation={toggleGroup.orientation}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented)
            rove(event, event.currentTarget, '[data-group-item]', toggleGroup.orientation, false);
        }}
      />
    )),
);
/** A toggle button pressed when its `value` is in the group values. */
export const ToggleGroupItem = view<
  Native<'button'> & { readonly toggleGroup: ToggleGroupHandle; readonly value: string }
>(({ toggleGroup, value, children, onClick, ...rest }) =>
  observe(toggleGroup.source, (state) => (
    <button
      {...rest}
      type="button"
      data-group-item=""
      disabled={state.disabled || rest.disabled}
      aria-pressed={state.values.includes(value)}
      tabindex={state.values.length === 0 || state.values[0] === value ? 0 : -1}
      data-checked={state.values.includes(value) ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) toggleGroup.toggleValue(value);
      }}
    >
      {children}
    </button>
  )),
);
