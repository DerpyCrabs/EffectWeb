import ChevronDown from '@effectweb/lucide/icons/chevron-down';
import X from '@effectweb/lucide/icons/x';
import Check from '@effectweb/lucide/icons/check';
import { view } from 'effectweb';
import * as Base from '@effectweb/base-ui/combobox';
import type { Native } from '@effectweb/base-ui/types';
import { cn } from './cn.js';
export { createCombobox, createFilter } from '@effectweb/base-ui/combobox';
export type { ComboboxHandle, ComboboxOptions } from '@effectweb/base-ui/combobox';
/** Styled Combobox part for explicit handle-based composition. */
export const Combobox = view<Native<'div'>>((props) => <div {...props} data-slot="combobox" />);
type Handle = Base.ComboboxHandle<unknown, boolean>;
/** Styled Combobox Input part for explicit handle-based composition. */
export const ComboboxInput = view<
  Base.ComboboxInputProps & { readonly showTrigger?: boolean; readonly showClear?: boolean }
>(({ class: className, children, showTrigger = true, showClear = false, ...props }) => (
  <div
    data-slot="input-group"
    role="group"
    class={cn(
      'group/input-group relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input transition-colors outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-disabled:bg-input/50 has-disabled:opacity-50 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:bg-input/30 dark:has-disabled:bg-input/80 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5',
      'w-auto',
      className,
    )}
  >
    <Base.ComboboxInput
      {...props}
      data-slot="input-group-control"
      class="h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-sm shadow-none outline-none ring-0 focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0 dark:bg-transparent dark:disabled:bg-transparent"
    />
    <div
      data-slot="input-group-addon"
      data-align="inline-end"
      class="order-last flex items-center pr-2 text-muted-foreground"
    >
      {showTrigger ? <ComboboxTrigger combobox={props.combobox} disabled={props.disabled} /> : null}
      {showClear ? <ComboboxClear combobox={props.combobox} disabled={props.disabled} /> : null}
    </div>
    {children}
  </div>
));
/** Styled Combobox Content part for explicit handle-based composition. */
export const ComboboxContent = view<Base.ComboboxPopupProps>(({ class: className, ...props }) => (
  <Base.ComboboxPopup
    {...props}
    data-slot="combobox-content"
    class={cn(
      'cn-menu-target cn-menu-translucent group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[chips=true]:min-w-(--anchor-width) data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-8 *:data-[slot=input-group]:border-input/30 *:data-[slot=input-group]:bg-input/30 *:data-[slot=input-group]:shadow-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
      className,
    )}
  />
));
/** Styled Combobox List part for explicit handle-based composition. */
export const ComboboxList = view<Native<'div'> & { readonly combobox: Handle }>(
  ({ class: className, ...props }) => (
    <Base.ComboboxList
      {...props}
      data-slot="combobox-list"
      class={cn(
        'no-scrollbar max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0',
        className,
      )}
    />
  ),
);
/** Styled Combobox Item part for explicit handle-based composition. */
export const ComboboxItem = view<Base.ComboboxItemProps>(
  ({ class: className, children, ...props }) => (
    <Base.ComboboxItem
      {...props}
      data-slot="combobox-item"
      class={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <Base.ComboboxItemIndicator
        combobox={props.combobox}
        value={props.value}
        class="pointer-events-none absolute right-2 flex size-4 items-center justify-center"
      >
        <Check />
      </Base.ComboboxItemIndicator>
    </Base.ComboboxItem>
  ),
);
/** Styled Combobox Group part for explicit handle-based composition. */
export const ComboboxGroup = view<Native<'div'> & { readonly labelId?: string }>(
  ({ class: className, ...props }) => (
    <Base.ComboboxGroup {...props} data-slot="combobox-group" class={cn('', className)} />
  ),
);
/** Styled Combobox Label part for explicit handle-based composition. */
export const ComboboxLabel = view<Native<'div'>>(({ class: className, ...props }) => (
  <Base.ComboboxGroupLabel
    {...props}
    data-slot="combobox-label"
    class={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
  />
));
/** Styled Combobox Empty part for explicit handle-based composition. */
export const ComboboxEmpty = view<Native<'div'> & { readonly combobox: Handle }>(
  ({ class: className, ...props }) => (
    <Base.ComboboxEmpty
      {...props}
      data-slot="combobox-empty"
      class={cn(
        'hidden w-full justify-center py-2 text-center text-sm text-muted-foreground group-data-empty/combobox-content:flex',
        className,
      )}
    />
  ),
);
/** Styled Combobox Separator part for explicit handle-based composition. */
export const ComboboxSeparator = view<Native<'div'>>(({ class: className, ...props }) => (
  <Base.ComboboxSeparator
    {...props}
    data-slot="combobox-separator"
    class={cn('-mx-1 my-1 h-px bg-border', className)}
  />
));
/** Styled Combobox Chips part for explicit handle-based composition. */
export const ComboboxChips = view<Native<'div'>>(({ class: className, ...props }) => (
  <Base.ComboboxChips
    {...props}
    data-slot="combobox-chips"
    class={cn(
      'flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent bg-clip-padding px-2.5 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 has-data-[slot=combobox-chip]:px-1 dark:bg-input/30 dark:has-aria-invalid:border-destructive/50 dark:has-aria-invalid:ring-destructive/40',
      className,
    )}
  />
));
/** Styled Combobox Chip part for explicit handle-based composition. */
export const ComboboxChip = view<
  Native<'span'> & {
    readonly combobox: Handle;
    readonly value: unknown;
    readonly showRemove?: boolean;
  }
>(({ class: className, children, showRemove = true, ...props }) => (
  <Base.ComboboxChip
    {...props}
    data-slot="combobox-chip"
    class={cn(
      'flex h-[calc(--spacing(5.25))] w-fit items-center justify-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap text-foreground has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50 has-data-[slot=combobox-chip-remove]:pr-0',
      className,
    )}
  >
    {children}
    {showRemove ? <ComboboxChipRemove combobox={props.combobox} value={props.value} /> : null}
  </Base.ComboboxChip>
));
/** Styled Combobox Chip Remove part for explicit handle-based composition. */
export const ComboboxChipRemove = view<
  Omit<Native<'button'>, 'value'> & { readonly combobox: Handle; readonly value: unknown }
>(({ class: className, children, ...props }) => (
  <Base.ComboboxChipRemove
    {...props}
    data-slot="combobox-chip-remove"
    class={cn('-ml-1 opacity-50 hover:opacity-100', className)}
  >
    {children}
    <X class="pointer-events-none size-4" />
  </Base.ComboboxChipRemove>
));
/** Styled Combobox Chips Input part for explicit handle-based composition. */
export const ComboboxChipsInput = view<Base.ComboboxInputProps>(
  ({ class: className, ...props }) => (
    <Base.ComboboxInput
      {...props}
      data-slot="combobox-chips-input"
      class={cn('min-w-16 flex-1 outline-none', className)}
    />
  ),
);
/** Styled Combobox Trigger part for explicit handle-based composition. */
export const ComboboxTrigger = view<Native<'button'> & { readonly combobox: Handle }>(
  ({ class: className, children, ...props }) => (
    <Base.ComboboxTrigger
      {...props}
      data-slot="combobox-trigger"
      class={cn("[&_svg:not([class*='size-'])]:size-4", className)}
    >
      {children}
      <ChevronDown class="pointer-events-none size-4 text-muted-foreground" />
    </Base.ComboboxTrigger>
  ),
);
/** Styled Combobox Clear part for explicit handle-based composition. */
export const ComboboxClear = view<Native<'button'> & { readonly combobox: Handle }>(
  ({ class: className, children, ...props }) => (
    <Base.ComboboxClear
      {...props}
      data-slot="combobox-clear"
      class={cn('size-6 rounded-md p-0', className)}
    >
      {children ?? <X class="pointer-events-none size-4" />}
    </Base.ComboboxClear>
  ),
);
/** Styled Combobox Collection part for explicit handle-based composition. */
export const ComboboxCollection = Base.ComboboxCollection;
/** Styled Combobox Value part for explicit handle-based composition. */
export const ComboboxValue = Base.ComboboxValue;
/** Styled Combobox Status part for explicit handle-based composition. */
export const ComboboxStatus = Base.ComboboxStatus;
/** Styled Combobox Create part for explicit handle-based composition. */
export const ComboboxCreate = Base.ComboboxCreate;
/** Styled Combobox Hidden Input part for explicit handle-based composition. */
export const ComboboxHiddenInput = Base.ComboboxHiddenInput;
