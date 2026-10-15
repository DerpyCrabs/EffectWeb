import type { DisabledState as MenubarSnapshot } from './controller.js';
/** Immutable state belonging to the Menubar family. */
export type MenubarState = MenubarSnapshot;
import { logicalKey } from './direction.js';
import { observe, view } from 'effectweb';
import { createStateController, type ControllerOptions, type DisabledState } from './controller.js';
import { rovingBinding, nextIndex } from './collection.js';
import { triggerBinding } from './overlay.js';
import {
  createFloatingMenu,
  FloatingMenuPopup,
  FloatingMenuPositioner,
  type FloatingMenuHandle,
  type FloatingMenuOptions,
} from './floating-menu.js';
import type { Native } from './types.js';

/** A parent-owned row whose child menus share keyboard routing and open state. */
export function createMenubar(options: ControllerOptions & Partial<DisabledState> = {}) {
  const state = createStateController<DisabledState>(
    { disabled: options.disabled ?? false },
    options,
  );
  const menus: FloatingMenuHandle[] = [];
  const enabled = () =>
    menus.filter(
      (menu) =>
        menu.trigger() &&
        !menu.source.model().disabled &&
        !menu.trigger()?.hasAttribute('disabled'),
    );
  const open = (menu: FloatingMenuHandle, key = 'ArrowDown') => {
    if (state.source.model().disabled) return;
    for (const other of menus) if (other !== menu) other.dismiss(false);
    menu.openFromKey(key);
  };
  const route = (menu: FloatingMenuHandle, event: KeyboardEvent) => {
    if (
      state.source.model().disabled ||
      event.defaultPrevented ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return;
    const key = logicalKey(event.key, event.target as Element);
    // A submenu trigger owns ArrowRight; ArrowLeft first returns to its parent.
    const target = event.target as HTMLElement;
    const inPopup = !!target.closest('[role=menu]');
    if (inPopup && (event.key === 'Home' || event.key === 'End')) return;
    if (key === 'ArrowRight' && target.getAttribute('aria-haspopup') === 'menu' && inPopup) return;
    if (key === 'ArrowLeft' && target.closest('[role=menu]')?.getAttribute('data-overlay-parent'))
      return;
    const candidates = enabled();
    const next = nextIndex(candidates.length, candidates.indexOf(menu), key, 'horizontal');
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = candidates[next];
    if (!selected) return;
    const wasOpen = menus.some((item) => item.source.model().open);
    for (const item of menus) item.dismiss(false);
    selected.trigger()?.focus();
    if (wasOpen) open(selected);
  };
  return {
    ...state,
    menus,
    open,
    createMenu: (menuOptions: FloatingMenuOptions = {}) => {
      const menu = createFloatingMenu({ ...menuOptions, routeKey: (event) => route(menu, event) });
      menus.push(menu);
      state.lifetime.own(menu.lifetime);
      return menu;
    },
    key: route,
    hover: (menu: FloatingMenuHandle) => {
      if (menus.some((item) => item.source.model().open) && !menu.source.model().open) open(menu);
    },
  };
}
export type MenubarHandle = ReturnType<typeof createMenubar>;
/** The `menubar` container; Left and Right move between triggers and switch open menus. */
export const MenubarRoot = view<Native<'div'> & { readonly menubar: MenubarHandle }>(
  ({ menubar: _menubar, ...rest }) => (
    <div
      {...rest}
      role="menubar"
      aria-orientation="horizontal"
      use={rovingBinding('[data-menubar-trigger]')}
    />
  ),
);
export type MenubarTriggerProps = Native<'button'> & {
  readonly menubar: MenubarHandle;
  readonly menu: FloatingMenuHandle;
};
/** A top-level menubar button; takes the `menubar` handle and its own `menu` handle. */
export const MenubarTrigger = view<MenubarTriggerProps>(
  ({ menubar, menu, onClick, onKeyDown, onPointerMove, children, ...rest }) =>
    observe(menubar.source, (bar) =>
      observe(menu.source, (state) => (
        <button
          {...rest}
          type="button"
          role="menuitem"
          data-menubar-trigger=""
          use={triggerBinding(menu)}
          disabled={bar.disabled || state.disabled || rest.disabled}
          aria-haspopup="menu"
          aria-controls={`${menu.id}-popup`}
          aria-expanded={state.open}
          data-open={state.open ? '' : undefined}
          data-closed={!state.open ? '' : undefined}
          onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented) {
              if (state.open) menu.dismiss();
              else menubar.open(menu);
            }
          }}
          onPointerMove={(event) => {
            onPointerMove?.(event);
            if (!event.defaultPrevented && !rest.disabled) menubar.hover(menu);
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            menubar.key(menu, event);
            if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              menubar.open(menu, event.key);
            }
          }}
        >
          {children}
        </button>
      )),
    ),
);
/** The popup of one menubar menu; contains the shared Menu items. */
export const MenubarPopup = FloatingMenuPopup;
/** Positions a menubar popup under its trigger. */
export const MenubarPositioner = FloatingMenuPositioner;
export { createFloatingMenu as createMenubarSubmenu } from './floating-menu.js';
export {
  MenuItem as MenubarItem,
  MenuCheckboxItem as MenubarCheckboxItem,
  MenuRadioGroup as MenubarRadioGroup,
  MenuRadioItem as MenubarRadioItem,
  MenuSubmenuTrigger as MenubarSubmenuTrigger,
  MenuGroup as MenubarGroup,
  MenuGroupLabel as MenubarGroupLabel,
  MenuSeparator as MenubarSeparator,
} from './menu.js';
