import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import { OverlayBackdrop } from './backdrop.js';
import { Positioner, Arrow } from './positioner.js';
import { composeMounts, observe, view } from 'effectweb';
import { popoverHoverBinding } from './popover.js';
import {
  createOverlay,
  popupBinding,
  triggerBinding,
  type OverlayHandle,
  type OverlayOptions,
  type PositionOptions,
} from './overlay.js';
import type { OpenState as PreviewCardSnapshot } from './controller.js';
import type { Native } from './types.js';
/** Immutable state belonging to the PreviewCard family. */
export type PreviewCardState = PreviewCardSnapshot;
export interface PreviewCardOptions extends OverlayOptions {
  /** Milliseconds of hover before the card opens; defaults to 600. */
  readonly delay?: number | undefined;
  /** Milliseconds after leaving before the card closes; defaults to 300. */
  readonly closeDelay?: number | undefined;
}
/** Create a parent-owned PreviewCard handle; pass it to the parts and own its lifetime. */
export const createPreviewCard = (options: PreviewCardOptions = {}) =>
  Object.assign(createOverlay({ restoreFocus: false, ...options, delay: options.delay ?? 600 }), {
    delay: options.delay ?? 600,
    closeDelay: options.closeDelay ?? 300,
  });
export type PreviewCardHandle = OverlayHandle & {
  readonly delay: number;
  readonly closeDelay: number;
};
export type PreviewCardTriggerProps = Native<'a'> & { readonly previewCard: PreviewCardHandle };
/** A link that previews its destination on hover or focus after the delay. */
export const PreviewCardTrigger = view<PreviewCardTriggerProps>(
  ({ previewCard, children, onFocus, onBlur, onKeyDown, ...rest }) =>
    observe(previewCard.source, (state) => (
      <a
        {...rest}
        use={composeMounts([
          rest.use,
          triggerBinding(previewCard),
          popoverHoverBinding({
            popover: previewCard,
            openOnHover: true,
            delay: previewCard.delay,
            closeDelay: previewCard.closeDelay,
          }),
        ])}
        aria-controls={`${previewCard.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="dialog"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onFocus={(event) => {
          onFocus?.(event);
          if (!event.defaultPrevented) previewCard.showDelayed({ reason: 'trigger-focus', event });
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.defaultPrevented) previewCard.hide({ reason: 'focus-out', event });
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === 'Escape') {
            event.preventDefault();
            previewCard.hide({ reason: 'escape-key', event });
          }
        }}
      >
        {children}
      </a>
    )),
);
export type PreviewCardPopupProps = Native<'div'> &
  PositionOptions & { readonly previewCard: PreviewCardHandle };
/** The preview surface in the top layer; it stays open while the pointer is inside. */
export const PreviewCardPopup = view<PreviewCardPopupProps>(
  ({
    previewCard,
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionAvoidance,
    anchor,
    ...rest
  }) => (
    <div
      {...rest}
      id={`${previewCard.id}-popup`}
      role="dialog"
      popover="manual"
      tabindex={-1}
      data-overlay-parent={previewCard.parent?.id}
      use={popupBinding({
        handle: previewCard,
        kind: 'popover',
        side,
        align,
        sideOffset,
        alignOffset,
        collisionAvoidance,
        anchor,
      })}
    >
      {children}
    </div>
  ),
);
/** Positions the preview card against its trigger. */
export const PreviewCardPositioner = view<
  Native<'div'> & PositionOptions & { readonly previewCard: PreviewCardHandle }
>(({ previewCard, ...rest }) => <Positioner {...rest} handle={previewCard} />);
/** An arrow element aligned to the trigger. */
export const PreviewCardArrow = view<Native<'span'> & { readonly previewCard: PreviewCardHandle }>(
  ({ previewCard, ...rest }) => <Arrow {...rest} handle={previewCard} />,
);
/** A visual backdrop shown while the preview card is open. */
export const PreviewCardBackdrop = view<
  Native<'div'> & { readonly previewCard: PreviewCardHandle }
>(({ previewCard, ...rest }) => <OverlayBackdrop {...rest} handle={previewCard} />);
export type PreviewCardPortalProps = Omit<OverlayPortalProps, 'handle'> & {
  readonly previewCard: PreviewCardHandle;
};
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const PreviewCardPortal = view<PreviewCardPortalProps>(({ previewCard, ...props }) => (
  <OverlayPortal handle={previewCard} {...props} />
));
