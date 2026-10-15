import { view, type View } from 'effectweb';
import * as Base from '@effectweb/base-ui/context-menu';
import { cn } from './cn.js';
type Props<T> = T extends View<infer P, infer _E> ? P : never;
export { createContextMenu } from '@effectweb/base-ui/context-menu';
export type ContextMenuTriggerProps = Props<typeof Base.ContextMenuTrigger>;
/** Styled ContextMenuTrigger part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuTrigger: View<ContextMenuTriggerProps, never> =
  view<ContextMenuTriggerProps>(({ class: className, ...rest }) => (
    <Base.ContextMenuTrigger
      {...rest}
      data-slot="context-menu-trigger"
      class={cn('select-none', className)}
    />
  ));
export type ContextMenuContentProps = Props<typeof Base.ContextMenuPopup>;
/** Styled ContextMenuContent part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuContent: View<ContextMenuContentProps, never> =
  view<ContextMenuContentProps>(({ class: className, ...rest }) => (
    <Base.ContextMenuPopup
      side="right"
      align="start"
      sideOffset={0}
      alignOffset={4}
      {...rest}
      data-slot="context-menu-content"
      class={cn(
        'cn-menu-target cn-menu-translucent z-50 max-h-(--available-height) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
    />
  ));
export type ContextMenuPositionerProps = Props<typeof Base.ContextMenuPositioner>;
/** Styled ContextMenuPositioner part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuPositioner: View<ContextMenuPositionerProps, never> =
  view<ContextMenuPositionerProps>(({ class: className, ...rest }) => (
    <Base.ContextMenuPositioner
      {...rest}
      data-slot="context-menu-positioner"
      class={cn('', className)}
    />
  ));
export type ContextMenuItemProps = Props<typeof Base.ContextMenuItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled ContextMenuItem part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuItem: View<ContextMenuItemProps, never> = view<ContextMenuItemProps>(
  ({ class: className, inset, variant, ...rest }) => (
    <Base.ContextMenuItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="context-menu-item"
      class={cn(
        "group/context-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus:*:[svg]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
    />
  ),
);
export type ContextMenuCheckboxItemProps = Props<typeof Base.ContextMenuCheckboxItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled ContextMenuCheckboxItem part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuCheckboxItem: View<ContextMenuCheckboxItemProps, never> =
  view<ContextMenuCheckboxItemProps>(({ class: className, children, inset, variant, ...rest }) => (
    <Base.ContextMenuCheckboxItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="context-menu-checkbox-item"
      class={cn(
        'group',
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute right-2 hidden group-aria-checked:block"
      >
        ✓
      </span>
    </Base.ContextMenuCheckboxItem>
  ));
export type ContextMenuRadioItemProps = Props<typeof Base.ContextMenuRadioItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled ContextMenuRadioItem part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuRadioItem: View<ContextMenuRadioItemProps, never> =
  view<ContextMenuRadioItemProps>(({ class: className, children, inset, variant, ...rest }) => (
    <Base.ContextMenuRadioItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="context-menu-radio-item"
      class={cn(
        'group',
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute right-2 hidden group-aria-checked:block"
      >
        ●
      </span>
    </Base.ContextMenuRadioItem>
  ));
export type ContextMenuRadioGroupProps = Props<typeof Base.ContextMenuRadioGroup>;
/** Styled ContextMenuRadioGroup part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuRadioGroup: View<ContextMenuRadioGroupProps, never> =
  view<ContextMenuRadioGroupProps>(({ class: className, ...rest }) => (
    <Base.ContextMenuRadioGroup
      {...rest}
      data-slot="context-menu-radio-group"
      class={cn('', className)}
    />
  ));
export type ContextMenuGroupProps = Props<typeof Base.ContextMenuGroup>;
/** Styled ContextMenuGroup part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuGroup: View<ContextMenuGroupProps, never> = view<ContextMenuGroupProps>(
  ({ class: className, ...rest }) => (
    <Base.ContextMenuGroup {...rest} data-slot="context-menu-group" class={cn('', className)} />
  ),
);
export type ContextMenuLabelProps = Props<typeof Base.ContextMenuGroupLabel> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled ContextMenuLabel part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuLabel: View<ContextMenuLabelProps, never> = view<ContextMenuLabelProps>(
  ({ class: className, inset, variant, ...rest }) => (
    <Base.ContextMenuGroupLabel
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="context-menu-label"
      class={cn('px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7', className)}
    />
  ),
);
export type ContextMenuSeparatorProps = Props<typeof Base.ContextMenuSeparator>;
/** Styled ContextMenuSeparator part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuSeparator: View<ContextMenuSeparatorProps, never> =
  view<ContextMenuSeparatorProps>(({ class: className, ...rest }) => (
    <Base.ContextMenuSeparator
      {...rest}
      data-slot="context-menu-separator"
      class={cn('-mx-1 my-1 h-px bg-border', className)}
    />
  ));
export type ContextMenuSubTriggerProps = Props<typeof Base.ContextMenuSubmenuTrigger> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled ContextMenuSubTrigger part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuSubTrigger: View<ContextMenuSubTriggerProps, never> =
  view<ContextMenuSubTriggerProps>(({ class: className, children, inset, variant, ...rest }) => (
    <Base.ContextMenuSubmenuTrigger
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="context-menu-sub-trigger"
      class={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <span aria-hidden="true" class="ml-auto">
        ›
      </span>
    </Base.ContextMenuSubmenuTrigger>
  ));
export type ContextMenuSubContentProps = Props<typeof Base.ContextMenuPopup>;
/** Styled ContextMenuSubContent part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuSubContent: View<ContextMenuSubContentProps, never> =
  view<ContextMenuSubContentProps>(({ class: className, ...rest }) => (
    <Base.ContextMenuPopup
      side="right"
      align="start"
      {...rest}
      data-slot="context-menu-sub-content"
      class={cn(
        'cn-menu-target cn-menu-translucent z-50 max-h-(--available-height) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
    />
  ));
export type ContextMenuShortcutProps = {
  readonly children?: import('effectweb').JSX.Element;
  readonly class?: string | undefined;
};
/** Styled ContextMenuShortcut part; accepts native attributes and the explicit family handle where state is shared. */
export const ContextMenuShortcut: View<ContextMenuShortcutProps, never> =
  view<ContextMenuShortcutProps>(({ class: className, ...rest }) => (
    <span
      {...rest}
      data-slot="context-menu-shortcut"
      class={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
    />
  ));
