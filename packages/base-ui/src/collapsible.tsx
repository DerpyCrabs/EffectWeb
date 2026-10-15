import { panelPresence } from './presence.js';
import { observe, view } from 'effectweb';
import { createOpenController, type OpenOptions, type OpenState } from './controller.js';
import type { Native } from './types.js';
/** Create a parent-owned Collapsible handle; pass it to the parts and own its lifetime. */
export interface CollapsibleState extends OpenState {}
export interface CollapsibleOptions extends OpenOptions {}
/** Create a Collapsible handle: one open flag with setOpen and toggle, shared by the trigger and panel. */
export const createCollapsible = (options: CollapsibleOptions = {}) =>
  createOpenController(options);
export type CollapsibleHandle = ReturnType<typeof createCollapsible>;
/** The collapsible container; publishes `data-open` and `data-closed`. */
export const CollapsibleRoot = view<Native<'div'> & { readonly collapsible: CollapsibleHandle }>(
  ({ collapsible, ...rest }) =>
    observe(collapsible.source, (state) => (
      <div
        {...rest}
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
      />
    )),
);
/** The button that toggles the collapsible through its handle. */
export const CollapsibleTrigger = view<
  Native<'button'> & { readonly collapsible: CollapsibleHandle }
>(({ collapsible, onClick, children, ...rest }) =>
  observe(collapsible.source, (state) => (
    <button
      {...rest}
      type="button"
      disabled={state.disabled || rest.disabled}
      aria-expanded={state.open}
      aria-controls={`${collapsible.id}-panel`}
      data-open={state.open ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) collapsible.toggle();
      }}
    >
      {children}
    </button>
  )),
);
/** The content of a collapsible, hidden while closed. */
export const CollapsiblePanel = view<Native<'div'> & { readonly collapsible: CollapsibleHandle }>(
  ({ collapsible, ...rest }) =>
    observe(collapsible.source, (state) => (
      <div
        {...rest}
        id={`${collapsible.id}-panel`}
        use={panelPresence(state.open)}
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
      />
    )),
);
