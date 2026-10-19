import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import { domBinding, observe, view } from 'effectweb';
import {
  createFloatingMenu,
  FloatingMenuPopup,
  FloatingMenuPositioner,
  type FloatingMenuOptions,
} from './floating-menu.js';
import type { Native } from './types.js';

export interface ContextMenuOptions extends FloatingMenuOptions {
  readonly longPressDelay?: number | undefined;
}
/** Create once in a parent controller and own its lifetime. */
export function createContextMenu(options: ContextMenuOptions = {}) {
  const menu = createFloatingMenu(options);
  return {
    ...menu,
    longPressDelay: options.longPressDelay ?? 500,
    openAt: (x: number, y: number) => {
      menu.setAnchor({ getBoundingClientRect: () => ({ x, y, width: 0, height: 0 }) });
      menu.openFromKey('ArrowDown');
      // Reposition an already open menu at the new pointer coordinates.
      menu.sync({ open: menu.source.model().open });
    },
  };
}
export type ContextMenuHandle = ReturnType<typeof createContextMenu>;
const acquireContextTrigger = (element: HTMLElement, current: () => ContextMenuHandle) => {
  const menu = current();
  menu.attachTrigger(element);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin = { x: 0, y: 0 };
  let longPressed = false;
  const cancel = () => clearTimeout(timer);
  const down = (event: PointerEvent) => {
    cancel();
    longPressed = false;
    if (event.defaultPrevented || event.pointerType === 'mouse' || menu.source.model().disabled)
      return;
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      longPressed = true;
      menu.openAt(origin.x, origin.y);
    }, menu.longPressDelay);
  };
  const move = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel();
  };
  const click = (event: MouseEvent) => {
    if (longPressed) {
      longPressed = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };
  element.addEventListener('click', click, true);
  element.addEventListener('pointerdown', down);
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', cancel);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('pointerleave', cancel);
  return () => {
    cancel();
    menu.attachTrigger(undefined);
    element.removeEventListener('click', click, true);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', cancel);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('pointerleave', cancel);
  };
};
export type ContextMenuTriggerProps = Native<'div'> & { readonly menu: ContextMenuHandle };
/** Focusable region supporting pointer and keyboard context-menu activation. */
export const ContextMenuTrigger = view<ContextMenuTriggerProps>(
  ({ menu, onContextMenu, onKeyDown, ...rest }) =>
    observe(menu.source, (state) => (
      <div
        {...rest}
        tabindex={rest.tabindex ?? 0}
        use={{ ...domBinding(menu, acquireContextTrigger), identity: menu }}
        aria-haspopup="menu"
        aria-expanded={state.open}
        aria-controls={`${menu.id}-popup`}
        data-disabled={state.disabled ? '' : undefined}
        data-open={state.open ? '' : undefined}
        onContextMenu={(event) => {
          onContextMenu?.(event);
          if (!event.defaultPrevented && !state.disabled) {
            event.preventDefault();
            menu.openAt(event.clientX, event.clientY);
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (
            !event.defaultPrevented &&
            (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          ) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            menu.openAt(rect.x, rect.bottom);
          }
        }}
      />
    )),
);
/** The popup of a context menu; contains the shared Menu items. */
export const ContextMenuPopup = FloatingMenuPopup;
// Configuration lives on the same handle; the popup consumes the virtual anchor.
/** Positions the context menu at the pointer position recorded by the trigger, or at the trigger for keyboard activation. */
export const ContextMenuPositioner = FloatingMenuPositioner;
export {
  MenuItem as ContextMenuItem,
  MenuCheckboxItem as ContextMenuCheckboxItem,
  MenuRadioGroup as ContextMenuRadioGroup,
  MenuRadioItem as ContextMenuRadioItem,
  MenuSubmenuTrigger as ContextMenuSubmenuTrigger,
  MenuGroup as ContextMenuGroup,
  MenuGroupLabel as ContextMenuGroupLabel,
  MenuSeparator as ContextMenuSeparator,
} from './menu.js';

export type ContextMenuPortalProps = Omit<OverlayPortalProps, 'handle'> & {
  readonly contextMenu: ContextMenuHandle;
};
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const ContextMenuPortal = view<ContextMenuPortalProps>(({ contextMenu, ...props }) => (
  <OverlayPortal handle={contextMenu} {...props} />
));
