import { completeOverlayExit } from './overlay-portal.js';
import {
  focusPopupInitially,
  restorePopupFocus,
  type CloseInteraction,
  type PopupFocusOptions,
} from './popup-focus.js';
export type { PopupFocusOptions } from './popup-focus.js';
import { logicalKey } from './direction.js';
import { createPresence } from './presence.js';
import { domBinding } from 'effectweb';
import { createOpenController, type OpenOptions, type OpenHandle } from './controller.js';
import { resolvePositionAnchor } from './position-anchor.js';
import { placeElement, type Side, type Align, type CollisionAvoidance } from './positioning.js';
import { createListNavigation, enabledItems } from './collection.js';

export interface OverlayChangeCause {
  readonly reason:
    | 'trigger-hover'
    | 'trigger-focus'
    | 'trigger-press'
    | 'item-press'
    | 'outside-press'
    | 'escape-key'
    | 'close-press'
    | 'focus-out'
    | 'imperative-action'
    | 'none';
  readonly event: Event;
}
export interface OverlayChangeEventDetails extends OverlayChangeCause {
  readonly trigger: Element | undefined;
  readonly isCanceled: boolean;
  readonly isPropagationAllowed: boolean;
  readonly cancel: () => void;
  readonly allowPropagation: () => void;
}
export interface OverlayOptions extends Omit<OpenOptions, 'onOpenChange'> {
  readonly onOpenChangeComplete?: ((open: boolean) => void) | undefined;
  readonly onOpenChange?: ((open: boolean, details: OverlayChangeEventDetails) => void) | undefined;
  readonly parent?: OverlayHandle | undefined;
  readonly modal?: boolean | undefined;
  readonly delay?: number | undefined;
  readonly restoreFocus?: boolean | undefined;
}
function changeDetails(
  cause: OverlayChangeCause | undefined,
  trigger: Element | undefined,
): OverlayChangeEventDetails {
  if (cause && 'isCanceled' in cause) return cause as OverlayChangeEventDetails;
  let canceled = false;
  let propagationAllowed = false;
  const details: OverlayChangeEventDetails = {
    reason: cause?.reason ?? 'imperative-action',
    event: cause?.event ?? new Event('change'),
    trigger,
    get isCanceled() {
      return canceled;
    },
    get isPropagationAllowed() {
      return propagationAllowed;
    },
    cancel: () => {
      canceled = true;
    },
    allowPropagation: () => {
      propagationAllowed = true;
    },
  };
  return details;
}
/** Parent-owned overlay state, DOM anchors and delayed visibility actions. */
const completionCallbacks = new WeakMap<OverlayHandle, (open: boolean) => void>();
const openInteractions = new WeakMap<OverlayHandle['trigger'], CloseInteraction>();

/** Create shared open state, parent hierarchy, anchor and popup references for overlays. */
export function createOverlay(options: OverlayOptions = {}): OverlayHandle {
  // The overlay decides whether to accept a request after its cancellable callback.
  const primitive = createOpenController({
    ...options,
    open: options.open ?? options.defaultOpen ?? false,
    onOpenChange: undefined,
  });
  let trigger: HTMLElement | undefined;
  let popup: HTMLElement | undefined;
  let focusLast = false;
  let position: PositionOptions | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => clearTimeout(timer);
  const setOpen = (open: boolean, cause?: OverlayChangeCause): void => {
    cancel();
    const current = primitive.source.model();
    if (
      current.disabled ||
      current.open === open ||
      (open && options.parent && !options.parent.source.model().open)
    )
      return;
    const details = changeDetails(cause, trigger);
    options.onOpenChange?.(open, details);
    if (open && !details.isCanceled) {
      const event = cause?.event;
      openInteractions.set(
        handle.trigger,
        typeof PointerEvent !== 'undefined' && event instanceof PointerEvent
          ? event.pointerType === 'touch' || event.pointerType === 'pen'
            ? event.pointerType
            : 'mouse'
          : (typeof KeyboardEvent !== 'undefined' && event instanceof KeyboardEvent) ||
              (typeof MouseEvent !== 'undefined' &&
                event instanceof MouseEvent &&
                event.detail === 0)
            ? 'keyboard'
            : typeof MouseEvent !== 'undefined' && event instanceof MouseEvent
              ? 'mouse'
              : '',
      );
    }
    if (!details.isCanceled && options.open === undefined) primitive.sync({ open });
  };
  primitive.lifetime.own(cancel);
  if (options.parent)
    primitive.lifetime.own(
      options.parent.source.subscribe((state) => {
        if (!state.open) setOpen(false);
      }),
    );
  const handle: OverlayHandle = {
    ...primitive,
    setOpen,
    toggle: (cause?: OverlayChangeCause) => setOpen(!primitive.source.model().open, cause),
    sync: (next) => {
      if (next.open === false) cancel();
      primitive.sync(next);
    },
    openFromKey: (key: string, event?: KeyboardEvent) => {
      focusLast = key === 'ArrowUp';
      setOpen(true, event ? { reason: 'trigger-press', event } : undefined);
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
    showDelayed: (cause?: OverlayChangeCause) => {
      clearTimeout(timer);
      timer = setTimeout(() => setOpen(true, cause), options.delay ?? 0);
    },
    hide: (cause?: OverlayChangeCause) => {
      clearTimeout(timer);
      return setOpen(false, cause);
    },
    closeTree: (cause?: OverlayChangeCause) => {
      const details = changeDetails(cause, trigger);
      setOpen(false, details);
      if (!details.isCanceled) options.parent?.closeTree(details);
    },
  };
  if (options.onOpenChangeComplete) completionCallbacks.set(handle, options.onOpenChangeComplete);
  return handle;
}
export interface OverlayHandle extends OpenHandle {
  readonly setOpen: (open: boolean, cause?: OverlayChangeCause) => void;
  readonly toggle: (cause?: OverlayChangeCause) => void;
  readonly parent: OverlayHandle | undefined;
  readonly modal: boolean;
  readonly openFromKey: (key: string, event?: KeyboardEvent) => void;
  readonly focusLast: () => boolean;
  readonly position: () => PositionOptions | undefined;
  readonly configurePosition: (next: PositionOptions | undefined) => void;
  readonly restoreFocus: boolean;
  readonly trigger: () => HTMLElement | undefined;
  readonly popup: () => HTMLElement | undefined;
  readonly attachTrigger: (element: HTMLElement | undefined) => void;
  readonly attachPopup: (element: HTMLElement | undefined) => void;
  readonly showDelayed: (cause?: OverlayChangeCause) => void;
  readonly hide: (cause?: OverlayChangeCause) => void;
  readonly closeTree: (cause?: OverlayChangeCause) => void;
}
export interface PositionOptions {
  readonly anchor?:
    | Element
    | {
        readonly getBoundingClientRect: () => DOMRect;
        readonly contextElement?: Element | undefined;
      }
    | { readonly current: Element | null }
    | (() =>
        | Element
        | {
            readonly getBoundingClientRect: () => DOMRect;
            readonly contextElement?: Element | undefined;
          }
        | null
        | undefined)
    | null
    | undefined;
  readonly collisionAvoidance?: CollisionAvoidance | undefined;
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
interface PopupInput extends PositionOptions, PopupFocusOptions {
  readonly handle: OverlayHandle;
  readonly kind: 'dialog' | 'alertdialog' | 'popover' | 'menu' | 'listbox' | 'tooltip';
  readonly dismissible?: boolean | undefined;
}
const acquirePopup = (element: HTMLElement, current: () => PopupInput) => {
  const handle = current().handle;
  handle.attachPopup(element);
  let wasOpen: boolean | undefined;
  let hidden = false;
  let display = element.style.getPropertyValue('display');
  let displayPriority = element.style.getPropertyPriority('display');
  const conceal = () => {
    if (
      !hidden ||
      element.style.getPropertyValue('display') !== 'none' ||
      element.style.getPropertyPriority('display') !== 'important'
    ) {
      display = element.style.getPropertyValue('display');
      displayPriority = element.style.getPropertyPriority('display');
    }
    hidden = true;
    // Author utility classes override the UA's closed-popover display rule.
    element.style.setProperty('display', 'none', 'important');
  };
  const reveal = () => {
    if (!hidden) return;
    if (display) element.style.setProperty('display', display, displayPriority);
    else element.style.removeProperty('display');
    hidden = false;
  };
  let focusPending = false;
  const presence = createPresence(element);
  let returningFocus = true;
  let closeInteraction: CloseInteraction = 'keyboard';
  const isDialog = element instanceof HTMLDialogElement;
  const place = () => {
    const {
      anchor: suppliedAnchor,
      side,
      align,
      sideOffset,
      alignOffset,
      collisionAvoidance,
    } = { ...current(), ...handle.position() };
    const anchor = resolvePositionAnchor(suppliedAnchor, handle.trigger());
    if (!isDialog && anchor && handle.source.model().open) {
      placeElement(anchor, element, {
        side: side ?? 'bottom',
        align: align ?? 'center',
        offset: sideOffset ?? 4,
        alignOffset: alignOffset ?? 0,
        collisionAvoidance,
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
      if (hidden) conceal();
      place();
      return;
    }
    wasOpen = open;
    if (open) focusPending = true;
    presence.update(
      open,
      () => {
        reveal();
        const previous = element.ownerDocument.activeElement;
        if (isDialog) {
          if (handle.modal) element.showModal();
          else element.show();
        } else element.showPopover();
        place();
        const kind = current().kind;
        const interaction = openInteractions.get(handle.trigger) ?? '';
        let fallback: HTMLElement | undefined;
        if (kind === 'menu' || kind === 'listbox') {
          const items = enabledItems(element, '[role^="menuitem"], [role="option"]');
          fallback =
            items.find((item) => item.getAttribute('aria-selected') === 'true') ??
            (handle.focusLast() ? items.at(-1) : items[0]) ??
            element;
        } else if (kind !== 'tooltip') {
          fallback =
            interaction === 'touch'
              ? element
              : (enabledItems(element, 'button, input, select, textarea, a[href], [tabindex]').find(
                  (item) => item.tabIndex >= 0,
                ) ?? element);
        }
        if (kind !== 'tooltip')
          focusPopupInitially(current().initialFocus, fallback, previous, interaction);
      },
      () => {
        const restore = returningFocus && focusPending;
        focusPending = false;
        if (isDialog && element.open) element.close();
        else if (!isDialog && element.matches(':popover-open')) element.hidePopover();
        conceal();
        if (restore && handle.restoreFocus && current().kind !== 'tooltip')
          restorePopupFocus(current().finalFocus, handle.trigger(), closeInteraction);
        returningFocus = true;
      },
      (open) => {
        completionCallbacks.get(handle)?.(open);
        if (!open) completeOverlayExit(handle);
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
    const previous = returningFocus;
    returningFocus = false;
    const details = changeDetails({ reason: 'outside-press', event }, handle.trigger());
    handle.hide(details);
    if (details.isCanceled) returningFocus = previous;
  };
  const cancel = (event: Event) => {
    event.preventDefault();
    if (current().kind !== 'alertdialog' && current().dismissible !== false)
      handle.hide({ reason: 'escape-key', event });
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
      handle.hide({ reason: 'outside-press', event });
  };
  const navigate = createListNavigation();
  const key = (event: KeyboardEvent) => {
    if (!handle.source.model().open || event.defaultPrevented) return;
    if (
      event.key === 'Escape' ||
      (handle.parent && logicalKey(event.key, element) === 'ArrowLeft')
    ) {
      event.preventDefault();
      const details = changeDetails({ reason: 'escape-key', event }, handle.trigger());
      if (current().kind !== 'alertdialog' && current().dismissible !== false) handle.hide(details);
      if (!details.isPropagationAllowed) event.stopPropagation();
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
      handle.closeTree({ reason: 'focus-out', event });
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
    const previous = returningFocus;
    returningFocus = false;
    const details = changeDetails({ reason: 'focus-out', event }, handle.trigger());
    handle.hide(details);
    if (details.isCanceled) returningFocus = previous;
  };
  const close = () => {
    if (handle.source.model().open) handle.hide();
  };
  const doc = element.ownerDocument;
  const pointerInteraction = (event: PointerEvent) => {
    if (handle.source.model().open)
      closeInteraction =
        event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse';
  };
  const keyboardInteraction = () => {
    closeInteraction = 'keyboard';
  };
  doc.addEventListener('pointerdown', pointerInteraction, true);
  doc.addEventListener('keydown', keyboardInteraction, true);
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
      doc.removeEventListener('pointerdown', pointerInteraction, true);
      doc.removeEventListener('keydown', keyboardInteraction, true);
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
      if (focusPending && returningFocus && handle.restoreFocus && current().kind !== 'tooltip')
        restorePopupFocus(current().finalFocus, handle.trigger(), closeInteraction);
      focusPending = false;
      reveal();
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
