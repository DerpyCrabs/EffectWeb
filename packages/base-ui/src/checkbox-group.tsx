import { formControlBinding } from './form-reset.js';
import { observe, view } from 'effectweb';
import { createValuesController, type ValuesOptions, type ValuesState } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned CheckboxGroup handle; pass it to the parts and own its lifetime. */
export interface CheckboxGroupState extends ValuesState {}
export interface CheckboxGroupOptions extends Omit<ValuesOptions, 'multiple'> {
  /** Every value the group can hold; a parent checkbox selects or clears them all. */
  readonly allValues?: readonly string[] | undefined;
}
/** Create a CheckboxGroup handle: the checked values and disabled state shared by its checkboxes and an optional parent checkbox. */
export const createCheckboxGroup = (options: CheckboxGroupOptions = {}) => {
  const state = createValuesController({ ...options, multiple: true });
  const all = () => options.allValues ?? [];
  const initial = state.source.model().values;
  return Object.assign(state, {
    allValues: all,
    reset: () => {
      if (options.values === undefined) state.sync({ values: initial, dirty: false });
      else options.onValuesChange?.(initial);
    },
    setValues: (values: readonly string[]) => {
      if (state.source.model().disabled) return;
      if (options.values === undefined) state.sync({ values: [...values], dirty: true });
      options.onValuesChange?.(values);
    },
    /** Select every value of `allValues`, or clear the group. */
    setAll(checked: boolean) {
      if (state.source.model().disabled) return;
      const values = checked ? [...all()] : [];
      if (options.values === undefined) state.sync({ values, dirty: true });
      options.onValuesChange?.(values);
    },
  });
};
export type CheckboxGroupHandle = ReturnType<typeof createCheckboxGroup>;
/** The `group` container; publishes disabled state. */
export const CheckboxGroupRoot = view<
  Native<'div'> & { readonly checkboxGroup: CheckboxGroupHandle }
>(({ checkboxGroup, ...rest }) =>
  observe(checkboxGroup.source, (state) => (
    <div {...rest} role="group" data-disabled={state.disabled ? '' : undefined} />
  )),
);
/** A native checkbox whose `value` joins the group's values while checked. */
export const CheckboxGroupItem = view<
  Native<'input'> & { readonly checkboxGroup: CheckboxGroupHandle; readonly value: string }
>(({ checkboxGroup, value, onChange, ...rest }) =>
  observe(checkboxGroup.source, (state) => {
    const checked = state.values.includes(value);
    return (
      <input
        {...rest}
        type="checkbox"
        value={value}
        name={rest.name ?? checkboxGroup.id}
        checked={checked}
        disabled={state.disabled || rest.disabled}
        use={formControlBinding(checkboxGroup)}
        data-checked={checked ? '' : undefined}
        data-unchecked={!checked ? '' : undefined}
        data-disabled={state.disabled || rest.disabled ? '' : undefined}
        onChange={(event) => {
          onChange?.(event);
          if (!event.defaultPrevented) checkboxGroup.toggleValue(value);
          event.currentTarget.checked = checkboxGroup.source.model().values.includes(value);
        }}
      />
    );
  }),
);
/** A checkbox that selects or clears `allValues`; indeterminate while only some are checked. */
export const CheckboxGroupParent = view<
  Native<'input'> & { readonly checkboxGroup: CheckboxGroupHandle }
>(({ checkboxGroup, onChange, ...rest }) =>
  observe(checkboxGroup.source, (state) => {
    const all = checkboxGroup.allValues();
    const selected = all.filter((value) => state.values.includes(value)).length;
    const checked = all.length > 0 && selected === all.length;
    const indeterminate = selected > 0 && selected < all.length;
    return (
      <input
        {...rest}
        type="checkbox"
        checked={checked}
        disabled={state.disabled || rest.disabled}
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-controls={rest['aria-controls'] ?? checkboxGroup.id}
        data-checked={checked ? '' : undefined}
        data-unchecked={!checked && !indeterminate ? '' : undefined}
        data-indeterminate={indeterminate ? '' : undefined}
        use={formControlBinding(checkboxGroup, indeterminate)}
        onChange={(event) => {
          onChange?.(event);
          if (!event.defaultPrevented) checkboxGroup.setAll(!checked);
          const next = checkboxGroup.source.model().values;
          const count = all.filter((value) => next.includes(value)).length;
          event.currentTarget.checked = all.length > 0 && count === all.length;
          event.currentTarget.indeterminate = count > 0 && count < all.length;
        }}
      />
    );
  }),
);
