import { createAccordion } from '@effectweb/base-ui';
import {
  AccordionRoot,
  AccordionItem as BaseItem,
  AccordionTrigger as BaseTrigger,
  AccordionPanel,
  AccordionHeader,
} from '@effectweb/base-ui';
import { primitiveAdapter } from './adapter.js';
import { controllerView, list, view, type JSX } from 'effectweb';
import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import ChevronUp from '@effectweb/lucide/icons/chevron-up';
import { cn } from './cn.js';

export interface AccordionItemConfig {
  readonly value: string;
  readonly title: JSX.Element;
  readonly content: JSX.Element;
  readonly disabled?: boolean | undefined;
}

export interface AccordionProps {
  readonly items: ReadonlyArray<AccordionItemConfig>;
  /** The open items. With `multiple` unset the controller keeps at most one open. */
  readonly value: ReadonlyArray<string>;
  readonly onValueChange: (value: ReadonlyArray<string>) => void;
  readonly multiple?: boolean | undefined;
  readonly class?: string | undefined;
}

/** Exclusive or multiple disclosure, with disabled and roving keyboard behavior. */
export const Accordion = controllerView(
  {
    controller: (props: AccordionProps) =>
      primitiveAdapter(
        props,
        createAccordion,
        (read) => ({
          values: props.value,
          multiple: props.multiple,
          onValuesChange: (value) => read().onValueChange(value),
        }),
        (next) => ({ values: next.value }),
        (next) => ({ multiple: next.multiple ?? false }),
      ),
  },
  view((model) => (
    <AccordionRoot
      accordion={model.actions.handle}
      data-slot="accordion"
      class={cn('flex w-full flex-col', model.props.class)}
    >
      {list(
        model.props.items,
        (item) => item.value,
        (item) => (
          <AccordionItem accordion={model.actions.handle} value={item.value}>
            <AccordionTrigger
              accordion={model.actions.handle}
              value={item.value}
              disabled={item.disabled}
            >
              {item.title}
            </AccordionTrigger>
            <AccordionContent accordion={model.actions.handle} value={item.value}>
              {item.content}
            </AccordionContent>
          </AccordionItem>
        ),
      )}
    </AccordionRoot>
  )),
);

/** A styled accordion section; takes the `accordion` handle and a `value`. */
export const AccordionItem = view<Parameters<typeof BaseItem>[0]>(
  ({ class: className, ...props }) => (
    <BaseItem {...props} data-slot="accordion-item" class={cn('not-last:border-b', className)} />
  ),
);

/** The styled accordion trigger with the chevron. */
export const AccordionTrigger = view<Parameters<typeof BaseTrigger>[0]>(
  ({ class: className, children, ...props }) => (
    <AccordionHeader class="flex">
      <BaseTrigger
        {...props}
        data-slot="accordion-trigger"
        class={cn(
          'group/accordion-trigger relative flex flex-1 items-start justify-between rounded-lg border border-transparent py-2.5 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:after:border-ring aria-disabled:pointer-events-none aria-disabled:opacity-50 **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground',
          className,
        )}
      >
        {children}
        <ChevronDown
          data-slot="accordion-trigger-icon"
          class="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <ChevronUp
          data-slot="accordion-trigger-icon"
          class="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
      </BaseTrigger>
    </AccordionHeader>
  ),
);

/** The styled accordion panel. */
export const AccordionContent = view<Parameters<typeof AccordionPanel>[0]>(
  ({ class: className, children, ...props }) => (
    <AccordionPanel
      {...props}
      data-slot="accordion-content"
      class="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
    >
      <div
        class={cn(
          'h-(--accordion-panel-height) pt-0 pb-2.5 data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
          className,
        )}
      >
        {children}
      </div>
    </AccordionPanel>
  ),
);
