import { controlStyle } from '@effectweb/base-ui/control-style';
import { domBinding, modelOwner, observe, view, type View } from 'effectweb';
import { createDialog, DialogPopup, DialogClose } from '@effectweb/base-ui';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
import { Input } from './input.js';
export interface SidebarOptions {
  readonly open?: boolean | undefined;
  readonly defaultOpen?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}
/** Parent-owned provider state. Own lifetime; pass sidebar explicitly to interactive parts. */
export function createSidebar(options: SidebarOptions = {}) {
  const owner = modelOwner({
    open: options.open ?? options.defaultOpen ?? true,
    mobile: false,
    openMobile: false,
  });
  const dialog = createDialog({ onOpenChange: (openMobile) => owner.patch({ openMobile }) });
  owner.own(dialog.lifetime);
  const setOpen = (open: boolean) => {
    if (options.open === undefined) owner.patch({ open });
    options.onOpenChange?.(open);
  };
  const setOpenMobile = (open: boolean) => {
    dialog.setOpen(open);
  };
  return {
    source: owner.source,
    lifetime: owner,
    dialog,
    setOpen,
    setOpenMobile,
    sync: (state: { readonly open: boolean }) => owner.patch(state),
    setMobile: (mobile: boolean) => {
      owner.patch({ mobile });
      if (!mobile) setOpenMobile(false);
    },
    toggle: () => {
      const state = owner.read();
      if (state.mobile) setOpenMobile(!state.openMobile);
      else setOpen(!state.open);
    },
  };
}
export type SidebarHandle = ReturnType<typeof createSidebar>;
type SidebarProps = Native<'div'> & Styled & { readonly sidebar: SidebarHandle };
const acquireProvider = (element: HTMLElement, current: () => SidebarHandle) => {
  const window = element.ownerDocument.defaultView!;
  const media = window.matchMedia('(max-width: 767px)');
  const update = () => current().setMobile(media.matches);
  const shortcut = (event: KeyboardEvent) => {
    if (
      !event.defaultPrevented &&
      event.key.toLowerCase() === 'b' &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.repeat
    ) {
      event.preventDefault();
      current().toggle();
    }
  };
  update();
  media.addEventListener('change', update);
  window.addEventListener('keydown', shortcut);
  return {
    dispose: () => {
      media.removeEventListener('change', update);
      window.removeEventListener('keydown', shortcut);
    },
  };
};
/** Styled SidebarProvider part with native attributes and theme classes. */
export const SidebarProvider = view<SidebarProps>(
  ({ sidebar, class: className, style, ...rest }) => (
    <div
      {...rest}
      data-slot="sidebar-wrapper"
      use={domBinding(sidebar, acquireProvider)}
      style={controlStyle({ '--sidebar-width': '16rem', '--sidebar-width-icon': '3rem' }, style)}
      class={cn(
        'group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar',
        className,
      )}
    />
  ),
);
/** Styled Sidebar part with native attributes and theme classes. */
export const Sidebar = view<
  SidebarProps & {
    readonly side?: 'left' | 'right' | undefined;
    readonly variant?: 'sidebar' | 'floating' | 'inset' | undefined;
    readonly collapsible?: 'offcanvas' | 'icon' | 'none' | undefined;
  }
>(
  ({
    sidebar,
    side = 'left',
    variant = 'sidebar',
    collapsible = 'offcanvas',
    class: className,
    children,
    ...rest
  }) =>
    observe(sidebar.source, (state) => {
      if (collapsible === 'none')
        return (
          <div
            {...rest}
            data-slot="sidebar"
            class={cn(
              'flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground',
              className,
            )}
          >
            {children}
          </div>
        );
      if (state.mobile)
        return (
          <DialogPopup
            dialog={sidebar.dialog}
            aria-label="Sidebar"
            data-slot="sidebar"
            data-mobile="true"
            data-side={side}
            class={cn(
              'fixed inset-y-0 m-0 h-dvh max-h-none w-72 max-w-[90vw] border-0 bg-sidebar p-0 text-sidebar-foreground shadow-lg backdrop:bg-black/40 data-[side=right]:mr-0 data-[side=right]:ml-auto',
              className,
            )}
          >
            <div class="flex h-full w-full flex-col">{children}</div>
            <DialogClose
              dialog={sidebar.dialog}
              aria-label="Close sidebar"
              class="absolute top-2 right-2 rounded p-1"
            >
              ×
            </DialogClose>
          </DialogPopup>
        );
      return (
        <div
          data-slot="sidebar"
          class="group peer hidden text-sidebar-foreground md:block"
          data-state={state.open ? 'expanded' : 'collapsed'}
          data-collapsible={state.open ? '' : collapsible}
          data-variant={variant}
          data-side={side}
        >
          <div
            data-slot="sidebar-gap"
            class={cn(
              'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[collapsible=offcanvas]:w-0 group-data-[side=right]:rotate-180',
              variant === 'floating' || variant === 'inset'
                ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]'
                : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
            )}
          />
          <div
            {...rest}
            data-slot="sidebar-container"
            data-side={side}
            inert={!state.open && collapsible === 'offcanvas'}
            class={cn(
              'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex',
              variant === 'floating' || variant === 'inset'
                ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]'
                : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
              className,
            )}
          >
            <div
              data-sidebar="sidebar"
              data-slot="sidebar-inner"
              class="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border"
            >
              {children}
            </div>
          </div>
        </div>
      );
    }),
);
/** Styled SidebarTrigger part with native attributes and theme classes. */
export const SidebarTrigger = view<Native<'button'> & Styled & { readonly sidebar: SidebarHandle }>(
  ({ sidebar, onClick, children, class: className, ...rest }) =>
    observe(sidebar.source, (state) => (
      <button
        {...rest}
        type="button"
        data-sidebar="trigger"
        data-slot="sidebar-trigger"
        aria-label={rest['aria-label'] ?? 'Toggle Sidebar'}
        aria-expanded={state.mobile ? state.openMobile : state.open}
        class={cn(
          'inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) sidebar.toggle();
        }}
      >
        {children ?? '☰'}
      </button>
    )),
);
/** Styled SidebarRail part with native attributes and theme classes. */
export const SidebarRail = view<Native<'button'> & Styled & { readonly sidebar: SidebarHandle }>(
  ({ sidebar, onClick, class: className, ...rest }) => (
    <button
      {...rest}
      type="button"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabindex={-1}
      title="Toggle Sidebar"
      class={cn(
        'absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2 in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) sidebar.toggle();
      }}
    />
  ),
);
/** Styled SidebarInput part with native attributes and theme classes. */
export const SidebarInput = view<Native<'input'> & Styled>(({ class: className, ...rest }) => (
  <Input
    {...rest}
    data-slot="sidebar-input"
    data-sidebar="input"
    class={cn('h-8 w-full bg-background shadow-none', className)}
  />
));
/** Styled SidebarInset part with native attributes and theme classes. */
export const SidebarInset = view<Native<'main'> & Styled>(({ class: className, ...rest }) => (
  <main
    data-slot="sidebar-inset"
    data-sidebar="inset"
    class={cn(
      'relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
      className,
    )}
    {...rest}
  />
));
/** Styled SidebarHeader part with native attributes and theme classes. */
export const SidebarHeader = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-header"
    data-sidebar="header"
    class={cn('flex flex-col gap-2 p-2', className)}
    {...rest}
  />
));
/** Styled SidebarFooter part with native attributes and theme classes. */
export const SidebarFooter = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-footer"
    data-sidebar="footer"
    class={cn('flex flex-col gap-2 p-2', className)}
    {...rest}
  />
));
/** Styled SidebarContent part with native attributes and theme classes. */
export const SidebarContent = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-content"
    data-sidebar="content"
    class={cn(
      'no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
      className,
    )}
    {...rest}
  />
));
/** Styled SidebarGroup part with native attributes and theme classes. */
export const SidebarGroup = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-group"
    data-sidebar="group"
    class={cn('relative flex w-full min-w-0 flex-col p-2', className)}
    {...rest}
  />
));
/** Styled SidebarGroupContent part with native attributes and theme classes. */
export const SidebarGroupContent = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-group-content"
    data-sidebar="group-content"
    class={cn('w-full text-sm', className)}
    {...rest}
  />
));
/** Styled SidebarMenu part with native attributes and theme classes. */
export const SidebarMenu = view<Native<'ul'> & Styled>(({ class: className, ...rest }) => (
  <ul
    data-slot="sidebar-menu"
    data-sidebar="menu"
    class={cn('flex w-full min-w-0 flex-col gap-0', className)}
    {...rest}
  />
));
/** Styled SidebarMenuItem part with native attributes and theme classes. */
export const SidebarMenuItem = view<Native<'li'> & Styled>(({ class: className, ...rest }) => (
  <li
    data-slot="sidebar-menu-item"
    data-sidebar="menu-item"
    class={cn('group/menu-item relative', className)}
    {...rest}
  />
));
/** Styled SidebarMenuBadge part with native attributes and theme classes. */
export const SidebarMenuBadge = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-menu-badge"
    data-sidebar="menu-badge"
    class={cn(
      'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground',
      className,
    )}
    {...rest}
  />
));
/** Styled SidebarMenuSub part with native attributes and theme classes. */
export const SidebarMenuSub = view<Native<'ul'> & Styled>(({ class: className, ...rest }) => (
  <ul
    data-slot="sidebar-menu-sub"
    data-sidebar="menu-sub"
    class={cn(
      'mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden',
      className,
    )}
    {...rest}
  />
));
/** Styled SidebarMenuSubItem part with native attributes and theme classes. */
export const SidebarMenuSubItem = view<Native<'li'> & Styled>(({ class: className, ...rest }) => (
  <li
    data-slot="sidebar-menu-sub-item"
    data-sidebar="menu-sub-item"
    class={cn('group/menu-sub-item relative', className)}
    {...rest}
  />
));
/** Styled SidebarGroupLabel part with native attributes and theme classes. */
export const SidebarGroupLabel = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="sidebar-group-label"
    data-sidebar="group-label"
    class={cn(
      'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
      className,
    )}
    {...rest}
  />
));
/** Styled SidebarGroupAction part with native attributes and theme classes. */
export const SidebarGroupAction = view<Native<'button'> & Styled>(
  ({ class: className, ...rest }) => (
    <button
      type="button"
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      class={cn(
        'absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...rest}
    />
  ),
);
/** Styled SidebarMenuButton part with native attributes and theme classes. */
export const SidebarMenuButton = view<
  Native<'button'> &
    Styled & {
      readonly isActive?: boolean | undefined;
      readonly variant?: 'default' | 'outline' | undefined;
      readonly size?: 'default' | 'sm' | 'lg' | undefined;
      readonly tooltip?: string | undefined;
    }
>(({ class: className, isActive, variant = 'default', size = 'default', tooltip, ...rest }) => (
  <button
    type="button"
    {...rest}
    title={tooltip}
    data-slot="sidebar-menu-button"
    data-sidebar="menu-button"
    data-active={isActive ? '' : undefined}
    data-size={size}
    class={cn(
      'peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate',
      variant === 'outline'
        ? 'bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]'
        : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      size === 'sm'
        ? 'h-7 text-xs'
        : size === 'lg'
          ? 'h-12 text-sm group-data-[collapsible=icon]:p-0!'
          : 'h-8 text-sm',
      className,
    )}
  />
));
/** Styled SidebarSeparator part with native attributes and theme classes. */
export const SidebarSeparator = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    {...rest}
    role="separator"
    data-slot="sidebar-separator"
    data-sidebar="separator"
    class={cn('mx-2 h-px w-auto bg-sidebar-border', className)}
  />
));
/** Styled SidebarMenuSkeleton part with native attributes and theme classes. */
export const SidebarMenuSkeleton = view<
  Native<'div'> & Styled & { readonly showIcon?: boolean | undefined }
>(({ class: className, showIcon, ...rest }) => (
  <div
    {...rest}
    data-slot="sidebar-menu-skeleton"
    class={cn('flex h-8 items-center gap-2 rounded-md px-2', className)}
  >
    {showIcon ? <div class="size-4 animate-pulse rounded-md bg-muted" /> : null}
    <div class="h-4 w-3/4 animate-pulse rounded-md bg-muted" />
  </div>
));
/** Styled SidebarMenuAction part with native attributes and theme classes. */
export const SidebarMenuAction = view<
  Native<'button'> & Styled & { readonly showOnHover?: boolean | undefined }
>(({ class: className, showOnHover, ...rest }) => (
  <button
    type="button"
    {...rest}
    data-slot="sidebar-menu-action"
    data-sidebar="menu-action"
    class={cn(
      'absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0',
      showOnHover &&
        'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0',
      className,
    )}
  />
));
/** Styled SidebarMenuSubButton part with native attributes and theme classes. */
export const SidebarMenuSubButton: View<
  Native<'a'> &
    Styled & { readonly size?: 'sm' | 'md' | undefined; readonly isActive?: boolean | undefined },
  never
> = view<
  Native<'a'> &
    Styled & { readonly size?: 'sm' | 'md' | undefined; readonly isActive?: boolean | undefined }
>(({ class: className, size = 'md', isActive, ...rest }) => (
  <a
    {...rest}
    data-slot="sidebar-menu-sub-button"
    data-sidebar="menu-sub-button"
    data-size={size}
    data-active={isActive ? '' : undefined}
    class={cn(
      'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground',
      className,
    )}
  />
));
