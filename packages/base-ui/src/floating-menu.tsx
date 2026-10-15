import { logicalKey, direction } from './direction.js';
import { createPresence } from './presence.js';
import { domBinding, view } from 'effectweb';
import { createMenu, type MenuHandle, type MenuOptions } from './menu.js';
import { createListNavigation, enabledItems } from './collection.js';
import { placeRect, type Box } from './positioning.js';
import type { PositionOptions } from './overlay.js';
import type { Native } from './types.js';

/** A geometric anchor does not replace the real trigger used for focus restoration. */
export interface VirtualAnchor {
  readonly getBoundingClientRect: () => Box;
}
export interface FloatingMenuHandle extends MenuHandle {
  readonly anchor: () => VirtualAnchor | HTMLElement | undefined;
  readonly setAnchor: (anchor: VirtualAnchor | undefined) => void;
  readonly children: Set<FloatingMenuHandle>;
  readonly contains: (target: Node | null) => boolean;
  readonly dismiss: (restore?: boolean) => void;
  readonly takeRestore: () => boolean;
  readonly routeKey: (event: KeyboardEvent) => void;
}
export interface FloatingMenuOptions extends MenuOptions {
  readonly parent?: FloatingMenuHandle | undefined;
  readonly routeKey?: ((event: KeyboardEvent) => void) | undefined;
}
/** Shared context-menu/menubar engine, including arbitrarily deep interaction trees. */
export function createFloatingMenu(options: FloatingMenuOptions = {}): FloatingMenuHandle {
  const base = createMenu(options);
  const children = new Set<FloatingMenuHandle>();
  let anchor: VirtualAnchor | undefined;
  let restore = true;
  const handle: FloatingMenuHandle = {
    ...base,
    children,
    anchor: () => anchor ?? base.trigger(),
    setAnchor: (value) => {
      anchor = value;
    },
    contains: (target) =>
      !!target &&
      (!!base.trigger()?.contains(target) ||
        !!base.popup()?.contains(target) ||
        [...children].some((child) => child.contains(target))),
    dismiss: (focus = true) => {
      restore = focus;
      for (const child of children) child.dismiss(false);
      base.hide();
    },
    hide: () => handle.dismiss(),
    closeTree: () => {
      if (options.parent) options.parent.closeTree();
      else handle.dismiss();
    },
    takeRestore: () => {
      const value = restore;
      restore = true;
      return value;
    },
    routeKey: options.routeKey ?? options.parent?.routeKey ?? (() => {}),
  };
  options.parent?.children.add(handle);
  base.lifetime.own(() => options.parent?.children.delete(handle));
  return handle;
}

/** Apply virtual or DOM anchor geometry and publish the positioning contract. */
export function positionFloating(
  anchor: VirtualAnchor,
  element: HTMLElement,
  options: PositionOptions = {},
) {
  return placeRect(anchor.getBoundingClientRect(), element, {
    side: options.side ?? 'bottom',
    dir: direction(anchor instanceof Element ? anchor : element),
    align: options.align ?? 'start',
    offset: options.sideOffset ?? 4,
    alignOffset: options.alignOffset ?? 0,
  });
}
const acquireFloating = (
  element: HTMLElement,
  current: () => { menu: FloatingMenuHandle } & PositionOptions,
) => {
  const { menu } = current();
  menu.attachPopup(element);
  let shown = false;
  const presence = createPresence(element);
  const items = () => enabledItems(element, '[role^="menuitem"]');
  const position = () => {
    const anchor = menu.anchor();
    if (shown && anchor) positionFloating(anchor, element, { ...current(), ...menu.position() });
  };
  const sync = () => {
    const open = menu.source.model().open;
    if (shown === open) {
      position();
      return;
    }
    shown = open;
    presence.update(
      open,
      () => {
        element.showPopover();
        position();
        const targets = items();
        (menu.focusLast() ? targets.at(-1) : targets[0])?.focus();
      },
      () => {
        for (const child of menu.children) child.dismiss(false);
        if (element.matches(':popover-open')) element.hidePopover();
        if (menu.takeRestore() && menu.restoreFocus) menu.trigger()?.focus();
      },
    );
  };
  const navigate = createListNavigation();
  const key = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      !shown ||
      (event.target as Element).closest('[role=menu]') !== element
    )
      return;
    menu.routeKey(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' || (logicalKey(event.key, element) === 'ArrowLeft' && menu.parent)) {
      event.preventDefault();
      event.stopPropagation();
      menu.dismiss();
      return;
    }
    if (event.key === 'Tab') {
      let root = menu;
      while (root.parent && 'dismiss' in root.parent) root = root.parent as FloatingMenuHandle;
      root.trigger()?.focus();
      root.dismiss(false);
      return;
    }
    navigate(event, items(), element.ownerDocument.activeElement);
  };
  const outside = (event: Event) => {
    if (shown && !menu.contains(event.target as Node)) menu.dismiss(false);
  };
  const focusout = (event: FocusEvent) => {
    if (shown && event.relatedTarget && !menu.contains(event.relatedTarget as Node))
      menu.dismiss(false);
  };
  const stop = menu.source.subscribe(sync);
  const resize = new ResizeObserver(position);
  resize.observe(element);
  element.addEventListener('keydown', key);
  element.addEventListener('focusout', focusout);
  document.addEventListener('pointerdown', outside);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  sync();
  return {
    update: position,
    dispose: () => {
      presence.dispose();
      stop();
      resize.disconnect();
      element.removeEventListener('keydown', key);
      element.removeEventListener('focusout', focusout);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      if (element.matches(':popover-open')) element.hidePopover();
      menu.attachPopup(undefined);
    },
  };
};
export type FloatingMenuPopupProps = Native<'div'> &
  PositionOptions & { readonly menu: FloatingMenuHandle };
/** Top-layer popup shared by the two menu families. */
export const FloatingMenuPopup = view<FloatingMenuPopupProps>(
  ({ menu, side, align, sideOffset, alignOffset, ...rest }) => (
    <div
      {...rest}
      id={`${menu.id}-popup`}
      role="menu"
      popover="manual"
      tabindex={-1}
      data-overlay-parent={menu.parent?.id}
      use={{
        ...domBinding({ menu, side, align, sideOffset, alignOffset }, acquireFloating),
        identity: menu,
      }}
    />
  ),
);
const acquirePositioner = (
  element: HTMLElement,
  current: () => { menu: FloatingMenuHandle } & PositionOptions,
) => {
  const menu = current().menu;
  const sync = () => {
    const { side, align, sideOffset, alignOffset } = current();
    menu.configurePosition({ side, align, sideOffset, alignOffset });
    const popup = menu.popup();
    const anchor = menu.anchor();
    if (!popup || !anchor || !menu.source.model().open) return;
    positionFloating(anchor, popup, current());
    element.dataset.side = popup.dataset.side;
    element.dataset.align = popup.dataset.align;
    for (const name of [
      'anchor-width',
      'anchor-height',
      'positioner-width',
      'positioner-height',
      'available-width',
      'available-height',
      'transform-origin',
    ])
      element.style.setProperty(`--${name}`, popup.style.getPropertyValue(`--${name}`));
  };
  const stop = menu.source.subscribe(() => queueMicrotask(sync));
  const resize = new ResizeObserver(sync);
  resize.observe(element);
  window.addEventListener('resize', sync);
  window.addEventListener('scroll', sync, true);
  queueMicrotask(sync);
  return {
    update: sync,
    dispose: () => {
      stop();
      resize.disconnect();
      menu.configurePosition(undefined);
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    },
  };
};
/** Structural positioner publishes geometry while its popup occupies the top layer. */
export const FloatingMenuPositioner = view<FloatingMenuPopupProps>(
  ({ menu, side, align, sideOffset, alignOffset, ...rest }) => (
    <div
      {...rest}
      use={{
        ...domBinding({ menu, side, align, sideOffset, alignOffset }, acquirePositioner),
        identity: menu,
      }}
    />
  ),
);
