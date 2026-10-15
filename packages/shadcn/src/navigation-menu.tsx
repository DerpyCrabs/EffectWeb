import { view, type View } from 'effectweb';
import * as Base from '@effectweb/base-ui/navigation-menu';
import { cn } from './cn.js';
type Props<T> = T extends View<infer P, infer _E> ? P : never;
export { createNavigationMenu } from '@effectweb/base-ui/navigation-menu';
export type NavigationMenuProps = Props<typeof Base.NavigationMenuRoot>;
/** Styled NavigationMenu part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenu: View<NavigationMenuProps, never> = view<NavigationMenuProps>(
  ({ class: className, ...rest }) => (
    <Base.NavigationMenuRoot
      {...rest}
      data-slot="navigation-menu"
      class={cn(
        'group/navigation-menu relative flex max-w-max flex-1 items-center justify-center',
        className,
      )}
    />
  ),
);
export type NavigationMenuListProps = Props<typeof Base.NavigationMenuList>;
/** Styled NavigationMenuList part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuList: View<NavigationMenuListProps, never> =
  view<NavigationMenuListProps>(({ class: className, ...rest }) => (
    <Base.NavigationMenuList
      {...rest}
      data-slot="navigation-menu-list"
      class={cn('group flex flex-1 list-none items-center justify-center gap-0', className)}
    />
  ));
export type NavigationMenuItemProps = Props<typeof Base.NavigationMenuItem> & {
  readonly inset?: boolean | undefined;
  readonly variant?: 'default' | 'destructive' | undefined;
};
/** Styled NavigationMenuItem part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuItem: View<NavigationMenuItemProps, never> =
  view<NavigationMenuItemProps>(({ class: className, inset, variant, ...rest }) => (
    <Base.NavigationMenuItem
      {...rest}
      data-inset={inset ? '' : undefined}
      data-variant={variant}
      data-slot="navigation-menu-item"
      class={cn('relative', className)}
    />
  ));
export type NavigationMenuTriggerProps = Props<typeof Base.NavigationMenuTrigger>;
/** Styled NavigationMenuTrigger part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuTrigger: View<NavigationMenuTriggerProps, never> =
  view<NavigationMenuTriggerProps>(({ class: className, children, ...rest }) => (
    <Base.NavigationMenuTrigger
      {...rest}
      data-slot="navigation-menu-trigger"
      class={cn(
        'group/navigation-menu-trigger inline-flex h-9 w-max items-center justify-center rounded-lg px-2.5 py-1.5 text-sm font-medium transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-popup-open:bg-muted/50 data-popup-open:hover:bg-muted data-open:bg-muted/50 data-open:hover:bg-muted data-open:focus:bg-muted',
        className,
      )}
    >
      {children}
      <span aria-hidden="true" class="ml-auto">
        ⌄
      </span>
    </Base.NavigationMenuTrigger>
  ));
export type NavigationMenuContentProps = Props<typeof Base.NavigationMenuContent>;
/** Styled NavigationMenuContent part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuContent: View<NavigationMenuContentProps, never> =
  view<NavigationMenuContentProps>(({ class: className, ...rest }) => (
    <Base.NavigationMenuContent
      {...rest}
      data-slot="navigation-menu-content"
      class={cn(
        'data-ending-style:data-activation-direction=left:translate-x-[50%] data-ending-style:data-activation-direction=right:translate-x-[-50%] data-starting-style:data-activation-direction=left:translate-x-[-50%] data-starting-style:data-activation-direction=right:translate-x-[50%] h-full w-auto p-1 transition-[opacity,transform,translate] duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[viewport=false]/navigation-menu:rounded-lg group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:shadow group-data-[viewport=false]/navigation-menu:ring-1 group-data-[viewport=false]/navigation-menu:ring-foreground/10 group-data-[viewport=false]/navigation-menu:duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out **:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none group-data-[viewport=false]/navigation-menu:data-open:animate-in group-data-[viewport=false]/navigation-menu:data-open:fade-in-0 group-data-[viewport=false]/navigation-menu:data-open:zoom-in-95 group-data-[viewport=false]/navigation-menu:data-closed:animate-out group-data-[viewport=false]/navigation-menu:data-closed:fade-out-0 group-data-[viewport=false]/navigation-menu:data-closed:zoom-out-95',
        className,
      )}
    />
  ));
export type NavigationMenuPositionerProps = Props<typeof Base.NavigationMenuPositioner>;
/** Styled NavigationMenuPositioner part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuPositioner: View<NavigationMenuPositionerProps, never> =
  view<NavigationMenuPositionerProps>(({ class: className, ...rest }) => (
    <Base.NavigationMenuPositioner
      {...rest}
      data-slot="navigation-menu-positioner"
      class={cn(
        'isolate z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom] duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)] data-instant:transition-none data-[side=bottom]:before:top-[-10px] data-[side=bottom]:before:right-0 data-[side=bottom]:before:left-0',
        className,
      )}
    />
  ));
export type NavigationMenuPopupProps = Props<typeof Base.NavigationMenuPopup>;
/** Styled NavigationMenuPopup part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuPopup: View<NavigationMenuPopupProps, never> =
  view<NavigationMenuPopupProps>(({ class: className, ...rest }) => (
    <Base.NavigationMenuPopup
      {...rest}
      data-slot="navigation-menu-popup"
      class={cn(
        'data-[ending-style]:easing-[ease] xs:w-(--popup-width) relative h-(--popup-height) w-(--popup-width) origin-(--transform-origin) rounded-lg bg-popover text-popover-foreground shadow ring-1 ring-foreground/10 transition-[opacity,transform,width,height,scale,translate] duration-[0.35s] ease-[cubic-bezier(0.22,1,0.36,1)] outline-none data-ending-style:scale-90 data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-90 data-starting-style:opacity-0',
        className,
      )}
    />
  ));
export type NavigationMenuViewportProps = Props<typeof Base.NavigationMenuViewport>;
/** Styled NavigationMenuViewport part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuViewport: View<NavigationMenuViewportProps, never> =
  view<NavigationMenuViewportProps>(({ class: className, ...rest }) => (
    <Base.NavigationMenuViewport
      {...rest}
      data-slot="navigation-menu-viewport"
      class={cn('relative size-full overflow-hidden', className)}
    />
  ));
/** Styled NavigationMenuLink part; accepts native attributes and the explicit family handle where state is shared. */
export const NavigationMenuLink: View<Base.NavigationMenuLinkProps, never> =
  view<Base.NavigationMenuLinkProps>(({ class: className, ...rest }) => (
    <Base.NavigationMenuLink
      {...rest}
      data-slot="navigation-menu-link"
      class={cn(
        "flex items-center gap-2 rounded-lg p-2 text-sm transition-all outline-none hover:bg-muted focus:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 in-data-[slot=navigation-menu-content]:rounded-md data-active:bg-muted/50 data-active:hover:bg-muted data-active:focus:bg-muted [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
    />
  ));
