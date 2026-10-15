import { observe, view } from 'effectweb';
import { createStateController, type ControllerOptions } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Fieldset handle; pass it to the parts and own its lifetime. */
export interface FieldsetState {
  readonly disabled: boolean;
  readonly invalid: boolean;
}
export interface FieldsetOptions extends ControllerOptions, Partial<FieldsetState> {}
/** Create a Fieldset handle: the disabled flag and the legend id shared by the root and legend. */
export const createFieldset = (options: FieldsetOptions = {}) =>
  createStateController<FieldsetState>(
    { disabled: options.disabled ?? false, invalid: options.invalid ?? false },
    options,
  );
export type FieldsetHandle = ReturnType<typeof createFieldset>;
/** A native fieldset bound to the handle; disables its descendants when disabled. */
export const FieldsetRoot = view<Native<'fieldset'> & { readonly fieldset: FieldsetHandle }>(
  ({ fieldset, ...rest }) =>
    observe(fieldset.source, (state) => (
      <fieldset
        {...rest}
        disabled={state.disabled || rest.disabled}
        data-disabled={state.disabled ? '' : undefined}
        data-invalid={state.invalid ? '' : undefined}
      />
    )),
);
/** The legend of a fieldset, referenced by the root for labelling. */
export const FieldsetLegend = view<Native<'legend'>>((props) => <legend {...props} />);

/** Stateless native grouping for controlled form layout adapters. */
export const FieldsetLayout = view<Native<'fieldset'>>((props) => (
  <fieldset {...props} data-disabled={props.disabled ? '' : undefined} />
));
