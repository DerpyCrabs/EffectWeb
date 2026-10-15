import type { DisabledState as ToolbarSnapshot } from './controller.js';
/** Immutable state belonging to the Toolbar family. */
export type ToolbarState = ToolbarSnapshot;
import { observe, view, type View } from 'effectweb';
import { createStateController, type ControllerOptions, type DisabledState } from './controller.js';
import { rove, rovingBinding } from './collection.js';
import type { Native } from './types.js';
/** Create an explicit parent-owned toolbar handle. */
export const createToolbar = (options: ControllerOptions & Partial<DisabledState> = {}) =>
  createStateController<DisabledState>({ disabled: options.disabled ?? false }, options);
export type ToolbarHandle = ReturnType<typeof createToolbar>;
const selector = '[data-toolbar-item]';
/** The `toolbar` container; arrow keys move focus between its controls. */
export const ToolbarRoot = view<Native<'div'> & { readonly toolbar: ToolbarHandle }>(
  ({ toolbar, onKeyDown, ...rest }) =>
    observe(toolbar.source, () => (
      <div
        {...rest}
        role="toolbar"
        aria-orientation={toolbar.orientation}
        data-orientation={toolbar.orientation}
        use={rovingBinding(selector)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (
            event.target instanceof HTMLInputElement &&
            ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
          )
            return;
          rove(event, event.currentTarget, selector, toolbar.orientation);
        }}
      />
    )),
);
/** A button inside a toolbar, part of its roving focus. */
export const ToolbarButton = view<Native<'button'>>((props) => (
  <button type="button" {...props} data-toolbar-item="" />
));
/** A link inside a toolbar, part of its roving focus. */
export const ToolbarLink: View<Native<'a'>, never> = view<Native<'a'>>((props) => (
  <a {...props} data-toolbar-item="" />
));
/** A text input inside a toolbar; caret keys stay native. */
export const ToolbarInput = view<Native<'input'>>((props) => (
  <input {...props} data-toolbar-item="" />
));
/** Groups toolbar controls. */
export const ToolbarGroup = view<Native<'div'>>((props) => <div {...props} role="group" />);
/** A separator between toolbar groups. */
export const ToolbarSeparator = view<Native<'div'> & { readonly toolbar: ToolbarHandle }>(
  ({ toolbar, ...rest }) =>
    observe(toolbar.source, () => (
      <div
        {...rest}
        role="separator"
        aria-orientation={toolbar.orientation === 'horizontal' ? 'vertical' : 'horizontal'}
      />
    )),
);
