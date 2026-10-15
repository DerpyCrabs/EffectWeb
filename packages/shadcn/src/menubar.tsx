import Check from '@effectweb/lucide/icons/check';
import { view, type View } from 'effectweb';
import * as Base from '@effectweb/base-ui/menubar';
import { cn } from './cn.js';
type Props<T> = T extends View<infer P, infer _E> ? P : never;
export { createMenubar } from '@effectweb/base-ui/menubar';
export { createMenubarSubmenu } from '@effectweb/base-ui/menubar';
export type MenubarProps = Props<typeof Base.MenubarRoot>;
/** Styled Menubar part; accepts native attributes and the explicit family handle where state is shared. */
export const Menubar: View<MenubarProps, never> = view<MenubarProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarRoot
      {...rest}
      data-slot="menubar"
      class={cn('flex h-8 items-center gap-0.5 rounded-lg border p-[3px]', className)}
    />
  ),
);
export type MenubarTriggerProps = Props<typeof Base.MenubarTrigger>;
/** Styled MenubarTrigger part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarTrigger: View<MenubarTriggerProps, never> = view<MenubarTriggerProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarTrigger
      {...rest}
      data-slot="menubar-trigger"
      class={cn(
        'flex items-center rounded-sm px-1.5 py-[2px] text-sm font-medium outline-hidden select-none hover:bg-muted aria-expanded:bg-muted',
        className,
      )}
    />
  ),
);
export type MenubarContentProps = Props<typeof Base.MenubarPopup>;
/** Styled MenubarContent part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarContent: View<MenubarContentProps, never> = view<MenubarContentProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarPopup
      align="start"
      sideOffset={8}
      alignOffset={-4}
      {...rest}
      data-slot="menubar-content"
      class={cn(
        'cn-menu-target cn-menu-translucent min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
        className,
      )}
    />
  ),
);
export type MenubarPositionerProps = Props<typeof Base.MenubarPositioner>;
/** Styled MenubarPositioner part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarPositioner: View<MenubarPositionerProps, never> = view<MenubarPositionerProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarPositioner {...rest} data-slot="menubar-positioner" class={cn('', className)} />
  ),
);
export type MenubarItemProps = Props<typeof Base.MenubarItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled MenubarItem part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarItem: View<MenubarItemProps, never> = view<MenubarItemProps>(
  ({ class: className, inset, variant, ...rest }) => (
    <Base.MenubarItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="menubar-item"
      class={cn(
        'relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none',
        "group/menubar-item gap-1.5 rounded-md px-1.5 py-1 text-sm focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive!",
        className,
      )}
    />
  ),
);
export type MenubarCheckboxItemProps = Props<typeof Base.MenubarCheckboxItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled MenubarCheckboxItem part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarCheckboxItem: View<MenubarCheckboxItemProps, never> =
  view<MenubarCheckboxItemProps>(({ class: className, children, inset, variant, ...rest }) => (
    <Base.MenubarCheckboxItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="menubar-checkbox-item"
      class={cn(
        'group',
        'relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-1.5 hidden size-4 items-center justify-center group-aria-checked:flex"
      >
        <Check class="size-4" />
      </span>
    </Base.MenubarCheckboxItem>
  ));
export type MenubarRadioItemProps = Props<typeof Base.MenubarRadioItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled MenubarRadioItem part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarRadioItem: View<MenubarRadioItemProps, never> = view<MenubarRadioItemProps>(
  ({ class: className, children, inset, variant, ...rest }) => (
    <Base.MenubarRadioItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="menubar-radio-item"
      class={cn(
        'group',
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-1.5 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-1.5 hidden size-4 items-center justify-center group-aria-checked:flex"
      >
        <Check class="size-4" />
      </span>
    </Base.MenubarRadioItem>
  ),
);
export type MenubarRadioGroupProps = Props<typeof Base.MenubarRadioGroup>;
/** Styled MenubarRadioGroup part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarRadioGroup: View<MenubarRadioGroupProps, never> = view<MenubarRadioGroupProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarRadioGroup {...rest} data-slot="menubar-radio-group" class={cn('', className)} />
  ),
);
export type MenubarGroupProps = Props<typeof Base.MenubarGroup>;
/** Styled MenubarGroup part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarGroup: View<MenubarGroupProps, never> = view<MenubarGroupProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarGroup {...rest} data-slot="menubar-group" class={cn('', className)} />
  ),
);
export type MenubarLabelProps = Props<typeof Base.MenubarGroupLabel> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled MenubarLabel part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarLabel: View<MenubarLabelProps, never> = view<MenubarLabelProps>(
  ({ class: className, inset, variant, ...rest }) => (
    <Base.MenubarGroupLabel
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="menubar-label"
      class={cn('px-1.5 py-1 text-sm font-medium data-inset:pl-7', className)}
    />
  ),
);
export type MenubarSeparatorProps = Props<typeof Base.MenubarSeparator>;
/** Styled MenubarSeparator part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarSeparator: View<MenubarSeparatorProps, never> = view<MenubarSeparatorProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarSeparator
      {...rest}
      data-slot="menubar-separator"
      class={cn('-mx-1 my-1 h-px bg-border', className)}
    />
  ),
);
export type MenubarSubTriggerProps = Props<typeof Base.MenubarSubmenuTrigger> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled MenubarSubTrigger part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarSubTrigger: View<MenubarSubTriggerProps, never> = view<MenubarSubTriggerProps>(
  ({ class: className, children, inset, variant, ...rest }) => (
    <Base.MenubarSubmenuTrigger
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="menubar-sub-trigger"
      class={cn(
        'relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none',
        "gap-1.5 rounded-md px-1.5 py-1 text-sm focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    >
      {children}
      <span aria-hidden="true" class="ml-auto">
        ›
      </span>
    </Base.MenubarSubmenuTrigger>
  ),
);
export type MenubarSubContentProps = Props<typeof Base.MenubarPopup>;
/** Styled MenubarSubContent part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarSubContent: View<MenubarSubContentProps, never> = view<MenubarSubContentProps>(
  ({ class: className, ...rest }) => (
    <Base.MenubarPopup
      side="right"
      align="start"
      {...rest}
      data-slot="menubar-sub-content"
      class={cn(
        'cn-menu-target cn-menu-translucent min-w-32 rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
    />
  ),
);
export type MenubarShortcutProps = {
  readonly children?: import('effectweb').JSX.Element;
  readonly class?: string | undefined;
};
/** Styled MenubarShortcut part; accepts native attributes and the explicit family handle where state is shared. */
export const MenubarShortcut: View<MenubarShortcutProps, never> = view<MenubarShortcutProps>(
  ({ class: className, ...rest }) => (
    <span
      {...rest}
      data-slot="menubar-shortcut"
      class={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
    />
  ),
);
