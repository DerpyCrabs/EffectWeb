import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import type { PopupFocusOptions } from './popup-focus.js';
import { composeMounts } from 'effectweb';
import type { OpenState as PopoverSnapshot } from './controller.js';
/** Immutable state belonging to the Popover family. */
export type PopoverState = PopoverSnapshot;
import { OverlayBackdrop } from './backdrop.js';
import { Positioner, Arrow } from './positioner.js';
import { observe, view, domBinding } from 'effectweb';
import {
  createOverlay,
  popupBinding,
  triggerBinding,
  type OverlayHandle,
  type OverlayOptions,
  type PositionOptions,
} from './overlay.js';
import type { Native } from './types.js';
/** Create a parent-owned Popover handle; pass it to the parts and own its lifetime. */
export const createPopover = (options: OverlayOptions = {}) => createOverlay(options);
export type PopoverHandle = OverlayHandle;
export type PopoverTriggerProps = Omit<Native<'button'>, 'popover'> & {
  readonly popover: PopoverHandle;
  readonly openOnHover?: boolean | undefined;
  readonly delay?: number | undefined;
  readonly closeDelay?: number | undefined;
};
/** A button that opens the popover from its `popover` handle. */
export const PopoverTrigger = view<PopoverTriggerProps>(
  ({ popover, children, onClick, onKeyDown, openOnHover, delay, closeDelay, ...rest }) =>
    observe(popover.source, (state) => (
      <button
        {...rest}
        type="button"
        use={composeMounts([
          rest.use,
          triggerBinding(popover),
          popoverHoverBinding({ popover, openOnHover, delay, closeDelay }),
        ])}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${popover.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="dialog"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) popover.toggle({ reason: 'trigger-press', event });
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            popover.setOpen(true, { reason: 'trigger-press', event });
          }
        }}
      >
        {children}
      </button>
    )),
);
export type PopoverPopupProps = Omit<Native<'div'>, 'popover'> &
  PositionOptions &
  PopupFocusOptions & { readonly popover: PopoverHandle };
/** The popover surface in the top layer; outside press, Escape and focus-out close it. */
export const PopoverPopup = view<PopoverPopupProps>(
  ({
    popover,
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionAvoidance,
    anchor,
    initialFocus,
    finalFocus,
    ...rest
  }) => (
    <div
      {...rest}
      id={`${popover.id}-popup`}
      role="dialog"
      popover="manual"
      tabindex={-1}
      data-overlay-parent={popover.parent?.id}
      use={composeMounts([
        rest.use,
        popupBinding({
          handle: popover,
          initialFocus,
          finalFocus,
          kind: 'popover',
          side,
          align,
          sideOffset,
          alignOffset,
          collisionAvoidance,
          anchor,
        }),
      ])}
    >
      {children}
    </div>
  ),
);
/** A button that closes the popover. */
export const PopoverClose = view<
  Omit<Native<'button'>, 'popover'> & { readonly popover: PopoverHandle }
>(({ popover, children, onClick, ...rest }) => (
  <button
    {...rest}
    type="button"
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) popover.hide({ reason: 'close-press', event });
    }}
  >
    {children}
  </button>
));
/** The popover heading; its id comes from the handle. */
export const PopoverTitle = view<
  Omit<Native<'h2'>, 'popover'> & { readonly popover: PopoverHandle }
>(({ popover, ...rest }) => <h2 {...rest} id={`${popover.id}-title`} />);
/** The popover text; its id comes from the handle. */
export const PopoverDescription = view<
  Omit<Native<'p'>, 'popover'> & { readonly popover: PopoverHandle }
>(({ popover, ...rest }) => <p {...rest} id={`${popover.id}-description`} />);

/** Positions the popover against its anchor. */
export const PopoverPositioner = view<
  Omit<Native<'div'>, 'popover'> & PositionOptions & { readonly popover: PopoverHandle }
>(({ popover, ...rest }) => <Positioner {...rest} handle={popover} />);
/** An arrow element aligned to the popover anchor. */
export const PopoverArrow = view<
  Omit<Native<'span'>, 'popover'> & { readonly popover: PopoverHandle }
>(({ popover, ...rest }) => <Arrow {...rest} handle={popover} />);

/** A visual backdrop shown while the popover is open. */
export const PopoverBackdrop = view<
  Omit<Native<'div'>, 'popover'> & { readonly popover: PopoverHandle }
>(({ popover, ...rest }) => <OverlayBackdrop {...rest} handle={popover} />);

/** Hover behavior for a custom trigger; acquire it on the same element as triggerBinding. */
export function popoverHoverBinding(
  input: Pick<PopoverTriggerProps, 'popover' | 'openOnHover' | 'delay' | 'closeDelay'>,
) {
  return domBinding(input, (element: HTMLElement, current) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (element.contains(target) || current().popover.popup()?.contains(target));
    const enter = (event: PointerEvent) => {
      const props = current();
      if (!props.openOnHover || event.pointerType === 'touch') return;
      clear();
      timer = setTimeout(
        () => current().popover.setOpen(true, { reason: 'trigger-hover', event }),
        props.delay ?? 300,
      );
    };
    const leave = (event: PointerEvent) => {
      if (!current().openOnHover || inside(event.relatedTarget)) return;
      clear();
      timer = setTimeout(
        () => current().popover.hide({ reason: 'trigger-hover', event }),
        current().closeDelay ?? 0,
      );
    };
    const popupEnter = (event: PointerEvent) => {
      if (
        current()
          .popover.popup()
          ?.contains(event.target as Node)
      )
        clear();
    };
    const popupLeave = (event: PointerEvent) => {
      if (
        current()
          .popover.popup()
          ?.contains(event.target as Node)
      )
        leave(event);
    };
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.ownerDocument.addEventListener('pointerover', popupEnter);
    element.ownerDocument.addEventListener('pointerout', popupLeave);
    return {
      update: () => {
        if (!current().openOnHover) clear();
      },
      dispose: () => {
        clear();
        element.removeEventListener('pointerenter', enter);
        element.removeEventListener('pointerleave', leave);
        element.ownerDocument.removeEventListener('pointerover', popupEnter);
        element.ownerDocument.removeEventListener('pointerout', popupLeave);
      },
    };
  });
}

export type PopoverPortalProps = Omit<OverlayPortalProps, 'handle'> & {
  readonly popover: PopoverHandle;
};
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const PopoverPortal = view<PopoverPortalProps>(({ popover, ...props }) => (
  <OverlayPortal handle={popover} {...props} />
));
