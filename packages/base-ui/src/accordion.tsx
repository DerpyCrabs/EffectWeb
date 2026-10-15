import { panelPresence } from './presence.js';
import { observe, view } from 'effectweb';
import { createValuesController, type ValuesOptions, type ValuesState } from './controller.js';
import { rove } from './collection.js';
import type { Native } from './types.js';
/** Create a parent-owned Accordion handle; pass it to the parts and own its lifetime. */
export interface AccordionState extends ValuesState {}
export interface AccordionOptions extends ValuesOptions {}
/** Create an Accordion handle: the open values and whether several may open, shared by the items. */
export const createAccordion = (options: AccordionOptions = {}) => createValuesController(options);
export type AccordionHandle = ReturnType<typeof createAccordion>;
/** The accordion container; publishes orientation and takes the `accordion` handle for its items. */
export const AccordionRoot = view<Native<'div'> & { readonly accordion: AccordionHandle }>(
  ({ accordion, onKeyDown, ...rest }) =>
    observe(accordion.source, () => (
      <div
        {...rest}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented)
            rove(event, event.currentTarget, '[data-accordion-trigger]', 'vertical');
        }}
        data-orientation={accordion.orientation}
      />
    )),
);
/** One accordion section identified by `value`; exposes `data-open` for its header and panel. */
export const AccordionItem = view<
  Native<'div'> & { readonly accordion: AccordionHandle; readonly value: string }
>(({ accordion, value, ...rest }) =>
  observe(accordion.source, (state) => (
    <div
      {...rest}
      data-open={state.values.includes(value) ? '' : undefined}
      data-closed={!state.values.includes(value) ? '' : undefined}
    />
  )),
);
/** The heading element wrapping an accordion trigger. */
export const AccordionHeader = view<Native<'h3'>>((props) => <h3 {...props} />);
/** The button that toggles its accordion item through the handle; supports arrow keys, Home and End across triggers. */
export const AccordionTrigger = view<
  Native<'button'> & { readonly accordion: AccordionHandle; readonly value: string }
>(({ accordion, value, onClick, children, ...rest }) =>
  observe(accordion.source, (state) => (
    <button
      {...rest}
      type="button"
      data-accordion-trigger=""
      disabled={state.disabled || rest.disabled}
      id={`${accordion.id}-trigger-${value}`}
      aria-expanded={state.values.includes(value)}
      aria-controls={`${accordion.id}-panel-${value}`}
      data-open={state.values.includes(value) ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) accordion.toggleValue(value);
      }}
    >
      {children}
    </button>
  )),
);
/** The content of an accordion item, hidden while its value is closed. */
export const AccordionPanel = view<
  Native<'div'> & { readonly accordion: AccordionHandle; readonly value: string }
>(({ accordion, value, ...rest }) =>
  observe(accordion.source, (state) => (
    <div
      {...rest}
      role="region"
      id={`${accordion.id}-panel-${value}`}
      aria-labelledby={`${accordion.id}-trigger-${value}`}
      use={panelPresence(state.values.includes(value))}
      data-open={state.values.includes(value) ? '' : undefined}
    />
  )),
);
