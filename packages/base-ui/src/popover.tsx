import type { OpenState as PopoverSnapshot } from './controller.js';
/** Immutable state belonging to the Popover family. */
export type PopoverState = PopoverSnapshot;
import { OverlayBackdrop } from './backdrop.js';
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
/** Create a parent-owned Popover handle; pass it to the parts and own its lifetime. */
export const createPopover = (options: OverlayOptions = {}) => createOverlay(options);
export type PopoverHandle = OverlayHandle;
export type PopoverTriggerProps = Omit<Native<'button'>, 'popover'> & {
  readonly popover: PopoverHandle;
};
/** A button that opens the popover from its `popover` handle. */
export const PopoverTrigger = view<PopoverTriggerProps>(
  ({ popover, children, onClick, onKeyDown, ...rest }) =>
    observe(popover.source, (state) => (
      <button
        {...rest}
        type="button"
        use={triggerBinding(popover)}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${popover.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="dialog"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) popover.toggle();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            popover.setOpen(true);
          }
        }}
      >
        {children}
      </button>
    )),
);
export type PopoverPopupProps = Omit<Native<'div'>, 'popover'> &
  PositionOptions & { readonly popover: PopoverHandle };
/** The popover surface in the top layer; outside press, Escape and focus-out close it. */
export const PopoverPopup = view<PopoverPopupProps>(
  ({ popover, children, side, align, sideOffset, alignOffset, ...rest }) => (
    <div
      {...rest}
      id={`${popover.id}-popup`}
      role="dialog"
      popover="manual"
      tabindex={-1}
      data-overlay-parent={popover.parent?.id}
      use={popupBinding({ handle: popover, kind: 'popover', side, align, sideOffset, alignOffset })}
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
      if (!event.defaultPrevented) popover.hide();
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
