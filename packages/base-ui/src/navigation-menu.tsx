import type { ValueState as NavigationMenuSnapshot } from './controller.js';
/** Immutable state belonging to the NavigationMenu family. */
export type NavigationMenuState = NavigationMenuSnapshot;
import { logicalKey } from './direction.js';
import { createPresence } from './presence.js';
import { domBinding, observe, view } from 'effectweb';
import { createValueController, type ValueOptions } from './controller.js';
import { enabledItems, nextIndex } from './collection.js';
import { positionFloating } from './floating-menu.js';
import type { PositionOptions } from './overlay.js';
import type { Native } from './types.js';

export interface NavigationMenuOptions extends ValueOptions {
  readonly delay?: number | undefined;
  readonly closeDelay?: number | undefined;
}
/** Explicit handle shared by the trigger row and a separately placed viewport. */
export function createNavigationMenu(options: NavigationMenuOptions = {}) {
  const primitive = createValueController(options);
  const triggers = new Map<string, HTMLElement>();
  const contents = new Map<string, HTMLElement>();
  let positioner: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  primitive.lifetime.own(cancel);
  const show = (value: string) => {
    cancel();
    primitive.setValue(value);
  };
  const hide = (restore = false) => {
    cancel();
    const trigger = triggers.get(primitive.source.model().value);
    primitive.setValue('');
    if (restore) trigger?.focus();
  };
  const focusContent = (last = false) => {
    const content = contents.get(primitive.source.model().value);
    if (!content) return;
    const items = enabledItems(
      content,
      'a[href], button, input, select, textarea, [tabindex]',
    ).filter((item) => item.tabIndex >= 0);
    (last ? items.at(-1) : items[0])?.focus();
  };
  return {
    ...primitive,
    triggers,
    contents,
    show,
    hide,
    cancel,
    focusContent,
    positioner: () => positioner,
    attachPositioner: (element: HTMLElement | undefined) => {
      positioner = element;
    },
    schedule: (value: string) => {
      cancel();
      timer = setTimeout(
        () => show(value),
        value ? (options.delay ?? 200) : (options.closeDelay ?? 150),
      );
    },
    contains: (target: Node | null) =>
      !!target &&
      (!!positioner?.contains(target) ||
        [...triggers.values()].some((trigger) => trigger.contains(target))),
    route: (value: string, event: KeyboardEvent) => {
      const entries = [...triggers.entries()].filter(
        ([, element]) => !element.hasAttribute('disabled'),
      );
      const next = nextIndex(
        entries.length,
        entries.findIndex(([key]) => key === value),
        logicalKey(event.key, event.target as Element),
        'horizontal',
      );
      if (next === null) return;
      event.preventDefault();
      const target = entries[next];
      if (target) {
        target[1].focus();
        if (primitive.source.model().value) show(target[0]);
      }
    },
  };
}
export type NavigationMenuHandle = ReturnType<typeof createNavigationMenu>;
export type NavigationMenuRootProps = Native<'nav'> & {
  readonly navigationMenu: NavigationMenuHandle;
};
/** The navigation container; takes the `navigationMenu` handle and owns hover and close delays. */
export const NavigationMenuRoot = view<NavigationMenuRootProps>(
  ({ navigationMenu: _handle, ...rest }) => <nav {...rest} />,
);
/** The list of navigation items. */
export const NavigationMenuList = view<Native<'ul'>>((props) => <ul {...props} />);
/** One navigation list item. */
export const NavigationMenuItem = view<Native<'li'>>((props) => <li {...props} />);
const acquireTrigger = (
  element: HTMLElement,
  current: () => { navigationMenu: NavigationMenuHandle; value: string },
) => {
  let input = current();
  const detach = () => {
    if (input.navigationMenu.triggers.get(input.value) === element)
      input.navigationMenu.triggers.delete(input.value);
  };
  input.navigationMenu.triggers.set(input.value, element);
  return {
    update: () => {
      detach();
      input = current();
      input.navigationMenu.triggers.set(input.value, element);
    },
    dispose: detach,
  };
};
export type NavigationMenuTriggerProps = Native<'button'> & {
  readonly navigationMenu: NavigationMenuHandle;
  readonly value: string;
};
/** A button that opens the content with the same `value`; hover opens after the delay. */
export const NavigationMenuTrigger = view<NavigationMenuTriggerProps>(
  ({
    navigationMenu,
    value,
    children,
    onClick,
    onKeyDown,
    onPointerEnter,
    onPointerLeave,
    ...rest
  }) =>
    observe(navigationMenu.source, (state) => (
      <button
        {...rest}
        type="button"
        id={`${navigationMenu.id}-trigger-${value}`}
        disabled={state.disabled || rest.disabled}
        aria-expanded={state.value === value}
        aria-controls={`${navigationMenu.id}-content-${value}`}
        data-open={state.value === value ? '' : undefined}
        data-popup-open={state.value === value ? '' : undefined}
        data-closed={state.value !== value ? '' : undefined}
        use={domBinding({ navigationMenu, value }, acquireTrigger)}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            if (state.value === value) navigationMenu.hide();
            else navigationMenu.show(value);
          }
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (!event.defaultPrevented && event.pointerType !== 'touch' && !rest.disabled)
            navigationMenu.schedule(value);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (!event.defaultPrevented) navigationMenu.schedule('');
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            navigationMenu.show(value);
            queueMicrotask(() => navigationMenu.focusContent(event.key === 'ArrowUp'));
          } else if (event.key === 'Escape') {
            event.preventDefault();
            navigationMenu.hide(true);
          } else navigationMenu.route(value, event);
        }}
      >
        {children}
      </button>
    )),
);
const acquireContent = (
  element: HTMLElement,
  current: () => { navigationMenu: NavigationMenuHandle; value: string },
) => {
  let input = current();
  const presence = createPresence(element);
  const sync = () =>
    presence.update(
      input.navigationMenu.source.model().value === input.value,
      () => {
        element.hidden = false;
      },
      () => {
        element.hidden = true;
      },
    );
  const attach = () => {
    input.navigationMenu.contents.set(input.value, element);
    sync();
    return input.navigationMenu.source.subscribe(sync);
  };
  let stop = attach();
  const detach = () => {
    stop();
    if (input.navigationMenu.contents.get(input.value) === element)
      input.navigationMenu.contents.delete(input.value);
  };
  return {
    update: () => {
      const next = current();
      if (next.navigationMenu !== input.navigationMenu || next.value !== input.value) {
        detach();
        input = next;
        stop = attach();
      } else sync();
    },
    dispose: () => {
      detach();
      presence.dispose();
    },
  };
};
export type NavigationMenuContentProps = Native<'div'> & {
  readonly navigationMenu: NavigationMenuHandle;
  readonly value: string;
};
/** The panel for one `value`, placed inside the shared viewport and hidden while another value is active. */
export const NavigationMenuContent = view<NavigationMenuContentProps>(
  ({ navigationMenu, value, onKeyDown, ...rest }) =>
    observe(navigationMenu.source, (state) => (
      <div
        {...rest}
        id={`${navigationMenu.id}-content-${value}`}
        aria-labelledby={`${navigationMenu.id}-trigger-${value}`}
        data-open={state.value === value ? '' : undefined}
        data-closed={state.value !== value ? '' : undefined}
        use={domBinding({ navigationMenu, value }, acquireContent)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            navigationMenu.hide(true);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            navigationMenu.route(value, event);
        }}
      />
    )),
);
export type NavigationMenuLinkProps = Native<'a'> & {
  readonly navigationMenu: NavigationMenuHandle;
  readonly active?: boolean | undefined;
};
/** A native link inside navigation content; supports `active` and closes the menu when followed. */
export const NavigationMenuLink = view<NavigationMenuLinkProps>(
  ({ navigationMenu, active, onClick, ...rest }) => (
    <a
      {...rest}
      aria-current={active ? 'page' : rest['aria-current']}
      data-active={active ? '' : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) navigationMenu.hide();
      }}
    />
  ),
);
const acquirePositioner = (
  element: HTMLElement,
  current: () => { navigationMenu: NavigationMenuHandle } & PositionOptions,
) => {
  const { navigationMenu: handle } = current();
  handle.attachPositioner(element);
  let shown = false;
  const presence = createPresence(element, true);
  const surfaces = [
    ...element.querySelectorAll<HTMLElement>('[data-navigation-popup], [data-navigation-viewport]'),
  ].map((surface) => createPresence(surface));
  const measure = () => {
    const value = handle.source.model().value;
    const trigger = handle.triggers.get(value);
    const content = handle.contents.get(value);
    if (!shown || !trigger || !content) return;
    const rect = { width: content.offsetWidth, height: content.offsetHeight };
    for (const target of [
      element,
      ...element.querySelectorAll<HTMLElement>(
        '[data-navigation-viewport], [data-navigation-popup]',
      ),
    ]) {
      for (const prefix of ['positioner', 'popup', 'navigation-menu-viewport']) {
        target.style.setProperty(`--${prefix}-width`, `${rect.width}px`);
        target.style.setProperty(`--${prefix}-height`, `${rect.height}px`);
      }
    }
    positionFloating(trigger, element, current());
  };
  const sync = () => {
    const open = !!handle.source.model().value;
    if (open !== shown) {
      for (const surface of surfaces)
        surface.update(
          open,
          () => {},
          () => {},
        );
      shown = open;
      presence.update(
        open,
        () => element.showPopover(),
        () => {
          if (element.matches(':popover-open')) element.hidePopover();
        },
      );
    }
    queueMicrotask(measure);
  };
  const outside = (event: Event) => {
    if (shown && !handle.contains(event.target as Node)) handle.hide();
  };
  const enter = () => handle.cancel();
  const leave = () => handle.schedule('');
  const focus = (event: FocusEvent) => {
    if (shown && !handle.contains(event.target as Node)) handle.hide();
  };
  const stop = handle.source.subscribe(sync);
  const resize = new ResizeObserver(measure);
  // Observe content after all child parts have attached, including inactive panels.
  queueMicrotask(() => {
    for (const content of handle.contents.values()) resize.observe(content);
    measure();
  });
  element.addEventListener('pointerenter', enter);
  element.addEventListener('pointerleave', leave);
  document.addEventListener('pointerdown', outside);
  document.addEventListener('focusin', focus);
  window.addEventListener('resize', measure);
  window.addEventListener('scroll', measure, true);
  sync();
  return {
    update: sync,
    dispose: () => {
      presence.dispose();
      for (const surface of surfaces) surface.dispose();
      stop();
      resize.disconnect();
      handle.cancel();
      handle.attachPositioner(undefined);
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focus);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      if (element.matches(':popover-open')) element.hidePopover();
    },
  };
};
export type NavigationMenuPositionerProps = Native<'div'> &
  PositionOptions & { readonly navigationMenu: NavigationMenuHandle };
/** Top-layer positioner contains Popup → Viewport → explicitly associated Content parts. */
export const NavigationMenuPositioner = view<NavigationMenuPositionerProps>(
  ({ navigationMenu, side, align, sideOffset, alignOffset, ...rest }) => (
    <div
      {...rest}
      popover="manual"
      use={{
        ...domBinding({ navigationMenu, side, align, sideOffset, alignOffset }, acquirePositioner),
        identity: navigationMenu,
      }}
    />
  ),
);
/** The popup wrapping the viewport; sized from the active content. */
export const NavigationMenuPopup = view<Native<'div'>>((props) => (
  <div {...props} data-navigation-popup="" />
));
/** The element that shows the active content and publishes its measured size as CSS variables. */
export const NavigationMenuViewport = view<Native<'div'>>((props) => (
  <div {...props} data-navigation-viewport="" />
));
