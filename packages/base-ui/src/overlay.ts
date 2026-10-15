import { logicalKey } from './direction.js';
import { createPresence } from './presence.js';
import { domBinding } from 'effectweb';
import { createOpenController, type OpenOptions, type OpenHandle } from './controller.js';
import { placeElement, type Side, type Align } from './positioning.js';
import { createListNavigation, enabledItems } from './collection.js';

export interface OverlayOptions extends OpenOptions {
  readonly parent?: OverlayHandle | undefined;
  readonly modal?: boolean | undefined;
  readonly delay?: number | undefined;
  readonly restoreFocus?: boolean | undefined;
}
/** Parent-owned overlay state, DOM anchors and delayed visibility actions. */
export function createOverlay(options: OverlayOptions = {}): OverlayHandle {
  const primitive = createOpenController(options);
  let trigger: HTMLElement | undefined;
  let popup: HTMLElement | undefined;
  let focusLast = false;
  let position: PositionOptions | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  const setOpen = (open: boolean) => {
    cancel();
    if (open && options.parent && !options.parent.source.model().open) return;
    primitive.setOpen(open);
  };
  primitive.lifetime.own(cancel);
  if (options.parent)
    primitive.lifetime.own(
      options.parent.source.subscribe((state) => {
        if (!state.open) setOpen(false);
      }),
    );
  return {
    ...primitive,
    setOpen,
    toggle: () => setOpen(!primitive.source.model().open),
    sync: (next) => {
      if (next.open === false) cancel();
      primitive.sync(next);
    },
    openFromKey: (key: string) => {
      focusLast = key === 'ArrowUp';
      setOpen(true);
    },
    focusLast: () => focusLast,
    position: () => position,
    configurePosition: (next: PositionOptions | undefined) => {
      position = next;
    },
    parent: options.parent,
    modal: options.modal ?? true,
    restoreFocus: options.restoreFocus ?? true,
    trigger: () => trigger,
    popup: () => popup,
    attachTrigger: (element: HTMLElement | undefined) => {
      trigger = element;
    },
    attachPopup: (element: HTMLElement | undefined) => {
      popup = element;
    },
    showDelayed: () => {
      clearTimeout(timer);
      timer = setTimeout(() => setOpen(true), options.delay ?? 0);
    },
    hide: () => {
      clearTimeout(timer);
      setOpen(false);
    },
    closeTree: () => {
      setOpen(false);
      options.parent?.closeTree();
    },
  };
}
export interface OverlayHandle extends OpenHandle {
  readonly parent: OverlayHandle | undefined;
  readonly modal: boolean;
  readonly openFromKey: (key: string) => void;
  readonly focusLast: () => boolean;
  readonly position: () => PositionOptions | undefined;
  readonly configurePosition: (next: PositionOptions | undefined) => void;
  readonly restoreFocus: boolean;
  readonly trigger: () => HTMLElement | undefined;
  readonly popup: () => HTMLElement | undefined;
  readonly attachTrigger: (element: HTMLElement | undefined) => void;
  readonly attachPopup: (element: HTMLElement | undefined) => void;
  readonly showDelayed: () => void;
  readonly hide: () => void;
  readonly closeTree: () => void;
}
export interface PositionOptions {
  readonly side?: Side | undefined;
  readonly align?: Align | undefined;
  readonly sideOffset?: number | undefined;
  readonly alignOffset?: number | undefined;
}
const acquireTrigger = (element: HTMLElement, current: () => OverlayHandle) => {
  const handle = current();
  handle.attachTrigger(element);
  return () => {
    if (handle.trigger() === element) handle.attachTrigger(undefined);
  };
};
/** Register the trigger element for positioning and focus restoration. */
export const triggerBinding = (handle: OverlayHandle) => ({
  ...domBinding(handle, acquireTrigger),
  identity: handle,
});
interface PopupInput extends PositionOptions {
  readonly handle: OverlayHandle;
  readonly kind: 'dialog' | 'alertdialog' | 'popover' | 'menu' | 'listbox' | 'tooltip';
  readonly dismissible?: boolean | undefined;
}
const acquirePopup = (element: HTMLElement, current: () => PopupInput) => {
  const handle = current().handle;
  handle.attachPopup(element);
  let wasOpen = false;
  const presence = createPresence(element);
  let returningFocus = true;
  const isDialog = element instanceof HTMLDialogElement;
  const place = () => {
    const { side, align, sideOffset, alignOffset } = { ...current(), ...handle.position() };
    const anchor = handle.trigger();
    if (!isDialog && anchor && handle.source.model().open) {
      placeElement(anchor, element, {
        side: side ?? 'bottom',
        align: align ?? 'center',
        offset: sideOffset ?? 4,
        alignOffset: alignOffset ?? 0,
      });
    }
  };
  const sync = () => {
    const open = handle.source.model().open;
    if (
      !element.hasAttribute('aria-label') &&
      !element.hasAttribute('aria-labelledby') &&
      element.ownerDocument.getElementById(`${handle.id}-title`)
    )
      element.setAttribute('aria-labelledby', `${handle.id}-title`);
    if (
      !element.hasAttribute('aria-describedby') &&
      element.ownerDocument.getElementById(`${handle.id}-description`)
    )
      element.setAttribute('aria-describedby', `${handle.id}-description`);
    if (open === wasOpen) {
      place();
      return;
    }
    wasOpen = open;
    presence.update(
      open,
      () => {
        if (isDialog) {
          if (handle.modal) element.showModal();
          else element.show();
        } else element.showPopover();
        place();
        if (current().kind === 'menu' || current().kind === 'listbox') {
          const items = enabledItems(element, '[role^="menuitem"], [role="option"]');
          (
            items.find((item) => item.getAttribute('aria-selected') === 'true') ??
            (handle.focusLast() ? items[items.length - 1] : items[0]) ??
            element
          ).focus();
        }
      },
      () => {
        const restore = returningFocus;
        if (isDialog && element.open) element.close();
        else if (!isDialog && element.matches(':popover-open')) element.hidePopover();
        if (restore && handle.restoreFocus && current().kind !== 'tooltip')
          handle.trigger()?.focus();
        returningFocus = true;
      },
    );
  };
  const inside = (target: Node | null) =>
    !!target && (element.contains(target) || !!handle.trigger()?.contains(target));
  const outside = (event: PointerEvent) => {
    if (!handle.source.model().open || isDialog || inside(event.target as Node)) return;
    // A child submenu belongs to the same interaction tree.
    const target = event.target as Element;
    if (target.closest(`[data-overlay-parent="${handle.id}"]`)) return;
    returningFocus = false;
    handle.hide();
  };
  const cancel = (event: Event) => {
    event.preventDefault();
    if (current().kind !== 'alertdialog' && current().dismissible !== false) handle.hide();
  };
  const click = (event: MouseEvent) => {
    if (
      !isDialog ||
      current().kind === 'alertdialog' ||
      current().dismissible === false ||
      event.target !== element
    )
      return;
    const r = element.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      handle.hide();
  };
  const navigate = createListNavigation();
  const key = (event: KeyboardEvent) => {
    if (!handle.source.model().open || event.defaultPrevented) return;
    if (
      event.key === 'Escape' ||
      (handle.parent && logicalKey(event.key, element) === 'ArrowLeft')
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (current().kind !== 'alertdialog' && current().dismissible !== false) handle.hide();
      return;
    }
    if (isDialog && handle.modal && event.key === 'Tab') {
      const items = enabledItems(
        element,
        'button, input, select, textarea, a[href], [tabindex]',
      ).filter((item) => item.tabIndex >= 0 && item.getClientRects().length > 0);
      const active = element.ownerDocument.activeElement;
      if (!items.length) {
        event.preventDefault();
        element.focus();
      } else if (event.shiftKey && active === items[0]) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (!event.shiftKey && active === items[items.length - 1]) {
        event.preventDefault();
        items[0]?.focus();
      }
      return;
    }
    if (current().kind !== 'menu' && current().kind !== 'listbox') return;
    if (event.key === 'Tab') {
      returningFocus = false;
      handle.closeTree();
      return;
    }
    const items = enabledItems(element, '[role^="menuitem"], [role="option"]');
    navigate(event, items, element.ownerDocument.activeElement);
  };
  const focusout = (event: FocusEvent) => {
    if (
      isDialog ||
      current().kind === 'tooltip' ||
      !event.relatedTarget ||
      inside(event.relatedTarget as Node)
    )
      return;
    if ((event.relatedTarget as Element).closest(`[data-overlay-parent="${handle.id}"]`)) return;
    returningFocus = false;
    handle.hide();
  };
  const close = () => {
    if (handle.source.model().open) handle.hide();
  };
  const doc = element.ownerDocument;
  const triggerKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && handle.trigger()?.contains(event.target as Node)) key(event);
  };
  doc.addEventListener('pointerdown', outside);
  doc.addEventListener('keydown', triggerKey);
  element.addEventListener('keydown', key);
  element.addEventListener('cancel', cancel);
  element.addEventListener('close', close);
  element.addEventListener('click', click);
  element.addEventListener('focusout', focusout);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  const resize = new ResizeObserver(place);
  resize.observe(element);
  if (handle.trigger()) resize.observe(handle.trigger()!);
  const unsubscribe = handle.source.subscribe(sync);
  sync();
  return {
    update: sync,
    dispose: () => {
      presence.dispose();
      unsubscribe();
      resize.disconnect();
      doc.removeEventListener('pointerdown', outside);
      doc.removeEventListener('keydown', triggerKey);
      element.removeEventListener('keydown', key);
      element.removeEventListener('cancel', cancel);
      element.removeEventListener('close', close);
      element.removeEventListener('click', click);
      element.removeEventListener('focusout', focusout);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      handle.attachPopup(undefined);
      if (isDialog && element.open) element.close();
      else if (!isDialog && element.matches(':popover-open')) element.hidePopover();
    },
  };
};
/** Own top-layer presentation, dismissal, positioning and composite focus. */
export const popupBinding = (input: PopupInput) => ({
  ...domBinding(input, acquirePopup),
  identity: input.handle,
});
/** Expose a primitive's current value in a native hidden form control. */
export type ValueHandle = ReturnType<typeof import('./controller.js').createValueController>;
