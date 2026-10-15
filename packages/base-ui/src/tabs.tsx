import { observe, view } from 'effectweb';
import { createValueController, type ValueOptions, type ValueState } from './controller.js';
import { rove, rovingBinding } from './collection.js';
import type { Native } from './types.js';
/** Create a parent-owned Tabs handle; pass it to the parts and own its lifetime. */
export interface TabsState extends ValueState {}
export interface TabsOptions extends ValueOptions {}
/** Create a Tabs handle: the selected value and orientation, shared by the list, tabs and panels. */
export const createTabs = (options: TabsOptions = {}) => createValueController(options);
export type TabsHandle = ReturnType<typeof createTabs>;
/** The `tablist`; arrow keys move between tabs with roving focus. */
export const TabsList = view<
  Native<'div'> & { readonly tabs: TabsHandle; readonly activateOnFocus?: boolean | undefined }
>(({ tabs, activateOnFocus, onKeyDown, ...rest }) =>
  observe(tabs.source, () => (
    <div
      {...rest}
      role="tablist"
      use={rovingBinding('[role=tab]')}
      aria-orientation={tabs.orientation}
      data-orientation={tabs.orientation}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented)
          rove(
            event,
            event.currentTarget,
            '[role=tab]',
            tabs.orientation,
            activateOnFocus !== false,
          );
      }}
    />
  )),
);
/** A tab selected when its `value` matches the handle. */
export const TabsTab = view<
  Native<'button'> & { readonly tabs: TabsHandle; readonly value: string }
>(({ tabs, value, children, onClick, ...rest }) =>
  observe(tabs.source, (state) => (
    <button
      {...rest}
      type="button"
      role="tab"
      id={`${tabs.id}-tab-${value}`}
      aria-controls={`${tabs.id}-panel-${value}`}
      aria-selected={state.value === value}
      tabindex={state.value === value ? 0 : -1}
      data-active={state.value === value ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tabs.setValue(value);
      }}
    >
      {children}
    </button>
  )),
);
/** The panel for one `value`, hidden while another tab is selected. */
export const TabsPanel = view<
  Native<'div'> & {
    readonly tabs: TabsHandle;
    readonly value: string;
    readonly keepMounted?: boolean | undefined;
  }
>(({ tabs, value, keepMounted, children, ...rest }) =>
  observe(tabs.source, (state) =>
    state.value === value || keepMounted ? (
      <div
        {...rest}
        role="tabpanel"
        id={`${tabs.id}-panel-${value}`}
        aria-labelledby={`${tabs.id}-tab-${value}`}
        hidden={state.value !== value}
        tabindex={0}
      >
        {children}
      </div>
    ) : null,
  ),
);
