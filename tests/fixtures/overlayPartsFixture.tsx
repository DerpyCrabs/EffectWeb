import { mount, view, modelOwner } from 'effectweb';
import {
  createDialog,
  createAlertDialog,
  createPopover,
  createDrawer,
} from '../../packages/base-ui/src/index';
import {
  DialogTrigger,
  DialogBackdrop,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
  AlertDialogTrigger,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  PopoverTrigger,
  PopoverBackdrop,
  PopoverPopup,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
  SheetTrigger,
  SheetBackdrop,
  SheetPopup,
  SheetTitle,
  SheetDescription,
  SheetClose,
  DrawerTrigger,
  DrawerBackdrop,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '../../packages/shadcn/src/index';
import './shadcn.css';
export function mountOverlayPartsFixture(host: HTMLElement) {
  const owner = modelOwner({});
  const dialog = createDialog();
  const alertDialog = createAlertDialog();
  const popover = createPopover();
  const sheet = createDrawer();
  const drawer = createDrawer();
  for (const handle of [dialog, alertDialog, popover, sheet, drawer]) owner.own(handle.lifetime);
  const Triggers = view(() => (
    <section>
      <DialogTrigger dialog={dialog}>Split dialog</DialogTrigger>
      <AlertDialogTrigger alertDialog={alertDialog}>Split alert</AlertDialogTrigger>
      <PopoverTrigger popover={popover}>Split popover</PopoverTrigger>
      <SheetTrigger sheet={sheet}>Split sheet</SheetTrigger>
      <DrawerTrigger drawer={drawer}>Split drawer</DrawerTrigger>
    </section>
  ));
  const Popups = view(() => (
    <section>
      <DialogBackdrop dialog={dialog} />
      <DialogPopup dialog={dialog}>
        <DialogTitle dialog={dialog}>Dialog title</DialogTitle>
        <DialogDescription dialog={dialog}>Dialog description</DialogDescription>
        <DialogClose dialog={dialog}>Done dialog</DialogClose>
      </DialogPopup>
      <AlertDialogBackdrop alertDialog={alertDialog} />
      <AlertDialogPopup alertDialog={alertDialog}>
        <AlertDialogTitle alertDialog={alertDialog}>Alert title</AlertDialogTitle>
        <AlertDialogDescription alertDialog={alertDialog}>Alert description</AlertDialogDescription>
        <AlertDialogClose alertDialog={alertDialog}>Done alert</AlertDialogClose>
      </AlertDialogPopup>
      <PopoverBackdrop popover={popover} />
      <PopoverPopup popover={popover}>
        <PopoverTitle popover={popover}>Popover title</PopoverTitle>
        <PopoverDescription popover={popover}>Popover description</PopoverDescription>
        <PopoverClose popover={popover}>Done popover</PopoverClose>
      </PopoverPopup>
      <SheetBackdrop sheet={sheet} />
      <SheetPopup sheet={sheet} side="left">
        <SheetTitle sheet={sheet}>Sheet title</SheetTitle>
        <SheetDescription sheet={sheet}>Sheet description</SheetDescription>
        <SheetClose sheet={sheet}>Done sheet</SheetClose>
      </SheetPopup>
      <DrawerBackdrop drawer={drawer} />
      <DrawerPopup drawer={drawer}>
        <DrawerTitle drawer={drawer}>Drawer title</DrawerTitle>
        <DrawerDescription drawer={drawer}>Drawer description</DrawerDescription>
        <DrawerClose drawer={drawer}>Done drawer</DrawerClose>
      </DrawerPopup>
    </section>
  ));
  const Page = view(() => (
    <>
      <Triggers />
      <Popups />
    </>
  ));
  const mounted = mount(host, Page, owner.source);
  return () => {
    mounted.dispose();
    owner.dispose();
  };
}
