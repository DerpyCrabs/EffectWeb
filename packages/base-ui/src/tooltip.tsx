import type { OpenState as TooltipSnapshot } from './controller.js';
/** Immutable state belonging to the Tooltip family. */
export type TooltipState = TooltipSnapshot;
import { Positioner, Arrow } from './positioner.js';
import { observe, view } from 'effectweb';
import {
  createOverlay,
  popupBinding,
  triggerBinding,
  type OverlayHandle,
  type OverlayOptions,
  type PositionOptions,
} from './overlay.js';
import type { Native } from './types.js';
/** Create a parent-owned Tooltip handle; pass it to the parts and own its lifetime. */
export const createTooltip = (options: OverlayOptions = {}) => createOverlay(options);
export type TooltipHandle = OverlayHandle;
export type TooltipTriggerProps = Native<'button'> & { readonly tooltip: TooltipHandle };
/** The element that shows the tooltip on hover or focus after the delay. */
export const TooltipTrigger = view<TooltipTriggerProps>(
  ({
    tooltip,
    children,
    onClick,
    onKeyDown,
    onPointerEnter,
    onPointerLeave,
    onFocus,
    onBlur,
    ...rest
  }) =>
    observe(tooltip.source, (state) => (
      <button
        {...rest}
        type="button"
        use={triggerBinding(tooltip)}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${tooltip.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="false"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) tooltip.toggle();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            tooltip.hide();
            return;
          }
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            tooltip.setOpen(true);
          }
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (!event.defaultPrevented) tooltip.showDelayed();
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (!event.defaultPrevented) tooltip.hide();
        }}
        onFocus={(event) => {
          onFocus?.(event);
          if (!event.defaultPrevented) tooltip.showDelayed();
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.defaultPrevented) tooltip.hide();
        }}
        aria-describedby={`${tooltip.id}-popup`}
      >
        {children}
      </button>
    )),
);
export type TooltipPopupProps = Native<'div'> &
  PositionOptions & { readonly tooltip: TooltipHandle };
/** The tooltip surface in the top layer; Escape hides it. */
export const TooltipPopup = view<TooltipPopupProps>(
  ({ tooltip, children, side, align, sideOffset, alignOffset, ...rest }) => (
    <div
      {...rest}
      id={`${tooltip.id}-popup`}
      role="tooltip"
      popover="manual"
      tabindex={-1}
      data-overlay-parent={tooltip.parent?.id}
      use={popupBinding({ handle: tooltip, kind: 'tooltip', side, align, sideOffset, alignOffset })}
    >
      {children}
    </div>
  ),
);
/** A button that hides the tooltip. */
export const TooltipClose = view<Native<'button'> & { readonly tooltip: TooltipHandle }>(
  ({ tooltip, children, onClick, ...rest }) => (
    <button
      {...rest}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) tooltip.hide();
      }}
    >
      {children}
    </button>
  ),
);
/** A heading inside a tooltip; its id comes from the handle. */
export const TooltipTitle = view<Native<'h2'> & { readonly tooltip: TooltipHandle }>(
  ({ tooltip, ...rest }) => <h2 {...rest} id={`${tooltip.id}-title`} />,
);
/** The tooltip text; its id comes from the handle. */
export const TooltipDescription = view<Native<'p'> & { readonly tooltip: TooltipHandle }>(
  ({ tooltip, ...rest }) => <p {...rest} id={`${tooltip.id}-description`} />,
);

/** Positions the tooltip against its trigger. */
export const TooltipPositioner = view<
  Native<'div'> & PositionOptions & { readonly tooltip: TooltipHandle }
>(({ tooltip, ...rest }) => <Positioner {...rest} handle={tooltip} />);
/** An arrow element aligned to the tooltip trigger. */
export const TooltipArrow = view<Native<'span'> & { readonly tooltip: TooltipHandle }>(
  ({ tooltip, ...rest }) => <Arrow {...rest} handle={tooltip} />,
);
