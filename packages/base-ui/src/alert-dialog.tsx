import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import type { PopupFocusOptions } from './popup-focus.js';
import { composeMounts } from 'effectweb';
import type { OpenState as AlertDialogSnapshot } from './controller.js';
/** Immutable state belonging to the AlertDialog family. */
export type AlertDialogState = AlertDialogSnapshot;
import { OverlayBackdrop } from './backdrop.js';
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
/** Create a parent-owned AlertDialog handle; pass it to the parts and own its lifetime. */
export const createAlertDialog = (options: OverlayOptions = {}) =>
  createOverlay({ ...options, modal: true });
export type AlertDialogHandle = OverlayHandle;
export type AlertDialogTriggerProps = Native<'button'> & {
  readonly alertDialog: AlertDialogHandle;
};
/** A button that opens the alert dialog from its `alertDialog` handle. */
export const AlertDialogTrigger = view<AlertDialogTriggerProps>(
  ({ alertDialog, children, onClick, onKeyDown, ...rest }) =>
    observe(alertDialog.source, (state) => (
      <button
        {...rest}
        type="button"
        use={composeMounts([rest.use, triggerBinding(alertDialog)])}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${alertDialog.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="dialog"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) alertDialog.toggle({ reason: 'trigger-press', event });
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            alertDialog.setOpen(true, { reason: 'trigger-press', event });
          }
        }}
      >
        {children}
      </button>
    )),
);
export type AlertDialogPopupProps = Native<'dialog'> &
  PositionOptions &
  PopupFocusOptions & { readonly alertDialog: AlertDialogHandle };
/** The modal `<dialog>` of an alert dialog; Escape and backdrop clicks do not close it. */
export const AlertDialogPopup = view<AlertDialogPopupProps>(
  ({
    alertDialog,
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionAvoidance,
    initialFocus,
    finalFocus,
    ...rest
  }) => (
    <dialog
      {...rest}
      id={`${alertDialog.id}-popup`}
      role="alertdialog"
      tabindex={-1}
      data-overlay-parent={alertDialog.parent?.id}
      use={composeMounts([
        rest.use,
        popupBinding({
          handle: alertDialog,
          initialFocus,
          finalFocus,
          kind: 'alertdialog',
          side,
          align,
          sideOffset,
          alignOffset,
          collisionAvoidance,
        }),
      ])}
    >
      {children}
    </dialog>
  ),
);
/** A button that closes the alert dialog, used for its cancel and action choices. */
export const AlertDialogClose = view<
  Native<'button'> & { readonly alertDialog: AlertDialogHandle }
>(({ alertDialog, children, onClick, ...rest }) => (
  <button
    {...rest}
    type="button"
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) alertDialog.hide({ reason: 'close-press', event });
    }}
  >
    {children}
  </button>
));
/** The alert dialog heading; its id comes from the handle so the popup is labelled by it. */
export const AlertDialogTitle = view<Native<'h2'> & { readonly alertDialog: AlertDialogHandle }>(
  ({ alertDialog, ...rest }) => <h2 {...rest} id={`${alertDialog.id}-title`} />,
);
/** The alert dialog text; its id comes from the handle for `aria-describedby`. */
export const AlertDialogDescription = view<
  Native<'p'> & { readonly alertDialog: AlertDialogHandle }
>(({ alertDialog, ...rest }) => <p {...rest} id={`${alertDialog.id}-description`} />);

/** A visual backdrop shown while the alert dialog is open; the native dialog owns modality. */
export const AlertDialogBackdrop = view<
  Omit<Native<'div'>, 'alertDialog'> & { readonly alertDialog: AlertDialogHandle }
>(({ alertDialog, ...rest }) => <OverlayBackdrop {...rest} handle={alertDialog} />);

export type AlertDialogPortalProps = Omit<OverlayPortalProps, 'handle'> & {
  readonly alertDialog: AlertDialogHandle;
};
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const AlertDialogPortal = view<AlertDialogPortalProps>(({ alertDialog, ...props }) => (
  <OverlayPortal handle={alertDialog} {...props} />
));
