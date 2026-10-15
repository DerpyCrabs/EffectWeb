import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import ChevronUp from '@effectweb/lucide/icons/chevron-up';
import Check from '@effectweb/lucide/icons/check';
import { controllerView, list, modelOwner, view, type JSX } from 'effectweb';
import { createSelect, SelectHiddenInput } from '@effectweb/base-ui';
import { cn } from './cn.js';
export interface SelectOption {
  readonly value: string;
  readonly label: JSX.Element;
  readonly disabled?: boolean | undefined;
}
export interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onValueChange?: ((value: string) => void) | undefined;
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly name?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly class?: string | undefined;
  readonly popupClass?: string | undefined;
  readonly 'aria-label'?: string | undefined;
}
function selectController(props: SelectProps) {
  const owner = modelOwner({ props });
  const select = createSelect({
    defaultValue: props.value ?? props.defaultValue ?? '',
    defaultOpen: props.open ?? props.defaultOpen ?? false,
    disabled: props.disabled ?? false,
    onValueChange: (value) => {
      const p = owner.read().props;
      if (p.value !== undefined) select.sync({ value: p.value });
      p.onValueChange?.(value ?? '');
    },
    onOpenChange: (open) => {
      const p = owner.read().props;
      if (p.open !== undefined) select.sync({ open: p.open });
      p.onOpenChange?.(open);
    },
  });
  owner.own(select.lifetime);
  return {
    source: owner.source,
    select,
    lifetime: owner,
    receive: (next: SelectProps) => {
      owner.patch({ props: next });
      select.sync({
        ...(next.value !== undefined ? { value: next.value } : {}),
        ...(next.open !== undefined ? { open: next.open } : {}),
        disabled: next.disabled ?? false,
      });
    },
  };
}
import { observe } from 'effectweb';
/** Custom listbox selection composed from styled parts and an owned controller. */
export const Select = controllerView(
  { controller: selectController },
  view((model) => (
    <span data-slot="select">
      <SelectTrigger
        select={model.actions.select}
        aria-label={model.props['aria-label']}
        data-slot="select-trigger"
        data-size="default"
        class={model.props.class}
      >
        {observe(
          model.actions.select.source,
          (state) =>
            model.props.options.find((option) => option.value === state.value)?.label ??
            model.props.placeholder ??
            'Select',
        )}
      </SelectTrigger>
      <SelectContent
        select={model.actions.select}
        align="start"
        data-slot="select-content"
        class={model.props.popupClass}
      >
        {list(
          model.props.options,
          (option) => option.value,
          (option) => (
            <SelectItem
              select={model.actions.select}
              value={option.value}
              disabled={option.disabled}
              data-slot="select-item"
            >
              {option.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
      {model.props.name ? (
        <SelectHiddenInput select={model.actions.select} name={model.props.name} />
      ) : null}
    </span>
  )),
);

import * as SelectParts from '@effectweb/base-ui/select';
import type { Native } from '@effectweb/base-ui/types';
/** Styled Select Group part for explicit handle-based composition. */
export const SelectGroup = view<Native<'div'> & { readonly labelId?: string }>(
  ({ class: className, ...props }) => (
    <SelectParts.SelectGroup
      {...props}
      data-slot="select-group"
      class={cn('scroll-my-1 p-1', className)}
    />
  ),
);
/** Styled Select Label part for explicit handle-based composition. */
export const SelectLabel = view<Native<'div'>>(({ class: className, ...props }) => (
  <SelectParts.SelectGroupLabel
    {...props}
    data-slot="select-label"
    class={cn('px-1.5 py-1 text-xs text-muted-foreground', className)}
  />
));
/** Styled Select Separator part for explicit handle-based composition. */
export const SelectSeparator = view<Native<'div'>>(({ class: className, ...props }) => (
  <SelectParts.SelectSeparator
    {...props}
    data-slot="select-separator"
    class={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
  />
));
/** Styled Select Scroll Up Button part for explicit handle-based composition. */
export const SelectScrollUpButton = view<
  Native<'div'> & { readonly select: SelectParts.SelectHandle<unknown, boolean> }
>(({ class: className, children, ...props }) => (
  <SelectParts.SelectScrollUpArrow
    {...props}
    data-slot="select-scroll-up-button"
    class={cn(
      "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
  >
    {children ?? <ChevronUp />}
  </SelectParts.SelectScrollUpArrow>
));
/** Styled Select Scroll Down Button part for explicit handle-based composition. */
export const SelectScrollDownButton = view<
  Native<'div'> & { readonly select: SelectParts.SelectHandle<unknown, boolean> }
>(({ class: className, children, ...props }) => (
  <SelectParts.SelectScrollDownArrow
    {...props}
    data-slot="select-scroll-down-button"
    class={cn(
      "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
  >
    {children ?? <ChevronDown />}
  </SelectParts.SelectScrollDownArrow>
));
/** Styled Select Value part for explicit handle-based composition. */
export const SelectValue = view<SelectParts.SelectValueProps>(({ class: className, ...props }) => (
  <SelectParts.SelectValue
    {...props}
    data-slot="select-value"
    class={cn('flex flex-1 text-left', className)}
  />
));
/** Styled Select Trigger part for explicit handle-based composition. */
export const SelectTrigger = view<
  SelectParts.SelectTriggerProps & { readonly size?: 'default' | 'sm' | undefined }
>(({ class: className, children, size = 'default', ...props }) => (
  <SelectParts.SelectTrigger
    {...props}
    data-slot="select-trigger"
    data-size={size}
    class={cn(
      "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className,
    )}
  >
    {children}
    <ChevronDown class="pointer-events-none size-4 text-muted-foreground" />
  </SelectParts.SelectTrigger>
));
/** Styled Select Content part for explicit handle-based composition. */
export const SelectContent = view<SelectParts.SelectPopupProps>(
  ({ class: className, children, ...props }) => (
    <SelectParts.SelectPopup
      {...props}
      data-slot="select-content"
      class={cn(
        'cn-menu-target cn-menu-translucent relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
    >
      <SelectScrollUpButton select={props.select} />
      <SelectParts.SelectList>{children}</SelectParts.SelectList>
      <SelectScrollDownButton select={props.select} />
    </SelectParts.SelectPopup>
  ),
);
/** Styled Select Item part for explicit handle-based composition. */
export const SelectItem = view<SelectParts.SelectItemProps>(
  ({ children, class: className, ...props }) => (
    <SelectParts.SelectItem
      {...props}
      data-slot="select-item"
      class={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
    >
      <SelectParts.SelectItemText class="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectParts.SelectItemText>
      <SelectParts.SelectItemIndicator
        select={props.select}
        value={props.value}
        class="pointer-events-none absolute right-2 flex size-4 items-center justify-center"
      >
        <Check />
      </SelectParts.SelectItemIndicator>
    </SelectParts.SelectItem>
  ),
);
