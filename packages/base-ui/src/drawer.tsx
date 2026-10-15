import { view } from 'effectweb';
import * as Dialog from './dialog.js';
export { createDialog as createDrawer } from './dialog.js';
export type DrawerHandle = Dialog.DialogHandle;
export type DrawerState = Dialog.DialogState;
export type DrawerTriggerProps = Omit<Parameters<typeof Dialog.DialogTrigger>[0], 'dialog'> & {
  readonly drawer: DrawerHandle;
};
/** A button that opens the drawer from its `drawer` handle. */
export const DrawerTrigger = view<DrawerTriggerProps>(({ drawer, ...rest }) => (
  <Dialog.DialogTrigger {...rest} dialog={drawer} />
));
export type DrawerPopupProps = Omit<Parameters<typeof Dialog.DialogPopup>[0], 'dialog'> & {
  readonly drawer: DrawerHandle;
};
/** The modal `<dialog>` of a drawer; the edge it slides from is styling. */
export const DrawerPopup = view<DrawerPopupProps>(({ drawer, ...rest }) => (
  <Dialog.DialogPopup {...rest} dialog={drawer} />
));
export type DrawerTitleProps = Omit<Parameters<typeof Dialog.DialogTitle>[0], 'dialog'> & {
  readonly drawer: DrawerHandle;
};
/** The drawer heading; its id comes from the handle. */
export const DrawerTitle = view<DrawerTitleProps>(({ drawer, ...rest }) => (
  <Dialog.DialogTitle {...rest} dialog={drawer} />
));
export type DrawerDescriptionProps = Omit<
  Parameters<typeof Dialog.DialogDescription>[0],
  'dialog'
> & { readonly drawer: DrawerHandle };
/** The drawer text; its id comes from the handle. */
export const DrawerDescription = view<DrawerDescriptionProps>(({ drawer, ...rest }) => (
  <Dialog.DialogDescription {...rest} dialog={drawer} />
));
export type DrawerCloseProps = Omit<Parameters<typeof Dialog.DialogClose>[0], 'dialog'> & {
  readonly drawer: DrawerHandle;
};
/** A button that closes the drawer through its handle. */
export const DrawerClose = view<DrawerCloseProps>(({ drawer, ...rest }) => (
  <Dialog.DialogClose {...rest} dialog={drawer} />
));
export type DrawerBackdropProps = Omit<Parameters<typeof Dialog.DialogBackdrop>[0], 'dialog'> & {
  readonly drawer: DrawerHandle;
};
/** A visual backdrop shown while the drawer is open. */
export const DrawerBackdrop = view<DrawerBackdropProps>(({ drawer, ...rest }) => (
  <Dialog.DialogBackdrop {...rest} dialog={drawer} />
));
