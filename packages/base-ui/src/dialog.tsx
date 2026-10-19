import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import type { PopupFocusOptions } from './popup-focus.js';
import { composeMounts } from 'effectweb';
import type { OpenState as DialogSnapshot } from './controller.js';
/** Immutable state belonging to the Dialog family. */
export type DialogState = DialogSnapshot;
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
/** Create a parent-owned Dialog handle; pass it to the parts and own its lifetime. */
export const createDialog = (options: OverlayOptions = {}) => createOverlay(options);
export type DialogHandle = OverlayHandle;
export type DialogTriggerProps = Native<'button'> & { readonly dialog: DialogHandle };
/** A button that opens the dialog from its `dialog` handle. */
export const DialogTrigger = view<DialogTriggerProps>(
  ({ dialog, children, onClick, onKeyDown, ...rest }) =>
    observe(dialog.source, (state) => (
      <button
        {...rest}
        type="button"
        use={composeMounts([rest.use, triggerBinding(dialog)])}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${dialog.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="dialog"
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) dialog.toggle({ reason: 'trigger-press', event });
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            dialog.setOpen(true, { reason: 'trigger-press', event });
          }
        }}
      >
        {children}
      </button>
    )),
);
export type DialogPopupProps = Native<'dialog'> &
  PositionOptions &
  PopupFocusOptions & { readonly dialog: DialogHandle; readonly dismissible?: boolean | undefined };
/** The modal `<dialog>` element; the browser contains focus and the handle owns open state and dismissal. */
export const DialogPopup = view<DialogPopupProps>(
  ({
    dialog,
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionAvoidance,
    dismissible,
    initialFocus,
    finalFocus,
    ...rest
  }) => (
    <dialog
      {...rest}
      id={`${dialog.id}-popup`}
      role={rest.role ?? 'dialog'}
      tabindex={-1}
      data-overlay-parent={dialog.parent?.id}
      use={composeMounts([
        rest.use,
        popupBinding({
          handle: dialog,
          initialFocus,
          finalFocus,
          kind: rest.role === 'alertdialog' ? 'alertdialog' : 'dialog',
          dismissible,
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
/** A button that closes the dialog through its handle. */
export const DialogClose = view<Native<'button'> & { readonly dialog: DialogHandle }>(
  ({ dialog, children, onClick, ...rest }) => (
    <button
      {...rest}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) dialog.hide({ reason: 'close-press', event });
      }}
    >
      {children}
    </button>
  ),
);
/** The dialog heading; its id comes from the handle so the popup is labelled by it. */
export const DialogTitle = view<Native<'h2'> & { readonly dialog: DialogHandle }>(
  ({ dialog, ...rest }) => <h2 {...rest} id={`${dialog.id}-title`} />,
);
/** The dialog text; its id comes from the handle for `aria-describedby`. */
export const DialogDescription = view<Native<'p'> & { readonly dialog: DialogHandle }>(
  ({ dialog, ...rest }) => <p {...rest} id={`${dialog.id}-description`} />,
);

/** A visual backdrop shown while the dialog is open; the native dialog owns modality. */
export const DialogBackdrop = view<
  Omit<Native<'div'>, 'dialog'> & { readonly dialog: DialogHandle }
>(({ dialog, ...rest }) => <OverlayBackdrop {...rest} handle={dialog} />);

export type DialogPortalProps = Omit<OverlayPortalProps, 'handle'> & {
  readonly dialog: DialogHandle;
};
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const DialogPortal = view<DialogPortalProps>(({ dialog, ...props }) => (
  <OverlayPortal handle={dialog} {...props} />
));
