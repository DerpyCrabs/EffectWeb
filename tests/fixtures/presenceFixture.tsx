import { mount, view, modelOwner, observe, list, entities } from 'effectweb';
import {
  createDialog,
  DialogPopup,
  createAlertDialog,
  AlertDialogPopup,
  createPopover,
  PopoverPopup,
  createMenu,
  MenuPopup,
  createTooltip,
  TooltipPopup,
  createSelect,
  SelectPopup,
  createCombobox,
  ComboboxPopup,
  createCollapsible,
  CollapsiblePanel,
  createAccordion,
  AccordionPanel,
  createContextMenu,
  ContextMenuPopup,
  createNavigationMenu,
  NavigationMenuPositioner,
  NavigationMenuPopup,
  NavigationMenuViewport,
  NavigationMenuContent,
  createToastManager,
  ToastRoot,
} from '../../packages/base-ui/src/index';
import { Dialog, Sheet } from '../../packages/shadcn/src/index';
import './shadcn.css';

let update: (open: boolean) => void = () => {};
export const setPresenceOpen = (open: boolean) => update(open);
export function mountPresenceFixture(host: HTMLElement, family: string, motion: boolean) {
  const owner = modelOwner({ open: false });
  const dialog = createDialog();
  const alertDialog = createAlertDialog();
  const popover = createPopover();
  const menu = createMenu();
  const tooltip = createTooltip();
  const select = createSelect();
  const combobox = createCombobox({ items: ['one'] });
  const collapsible = createCollapsible();
  const accordion = createAccordion();
  const context = createContextMenu();
  const navigation = createNavigationMenu();
  const manager = createToastManager({ timeout: 0 });
  for (const handle of [
    dialog,
    alertDialog,
    popover,
    menu,
    tooltip,
    select,
    combobox,
    collapsible,
    accordion,
    context,
    navigation,
    manager,
  ])
    owner.own(handle.lifetime);
  let toastId = '';
  update = (open) => {
    owner.patch({ open });
    (
      ({
        dialog,
        alertDialog,
        popover,
        menu,
        tooltip,
        select,
        combobox,
        collapsible,
        context,
      }) as Record<string, { setOpen(open: boolean): void }>
    )[family]?.setOpen(open);
    if (family === 'accordion') accordion.sync({ values: open ? ['one'] : [] });
    if (family === 'navigation') navigation.sync({ value: open ? 'one' : '' });
    if (family === 'toast') {
      if (open) toastId = manager.add({ title: 'Test toast' });
      else manager.close(toastId);
    }
  };
  const Part = view(() => (
    <>
      <style>
        {motion
          ? `.presence { opacity: 1; transition: opacity 300ms linear !important; animation: none !important; } .presence[data-starting-style], .presence[data-ending-style] { opacity: 0; }`
          : `.presence, .presence::backdrop { transition: none !important; animation: none !important; }`}
      </style>
      {family === 'dialog' ? (
        <DialogPopup dialog={dialog} class="presence" aria-label="Presence">
          Content
        </DialogPopup>
      ) : null}
      {family === 'alertDialog' ? (
        <AlertDialogPopup alertDialog={alertDialog} class="presence" aria-label="Presence">
          Content
        </AlertDialogPopup>
      ) : null}
      {family === 'popover' ? (
        <PopoverPopup popover={popover} class="presence">
          Content
        </PopoverPopup>
      ) : null}
      {family === 'menu' ? (
        <MenuPopup menu={menu} class="presence">
          Content
        </MenuPopup>
      ) : null}
      {family === 'tooltip' ? (
        <TooltipPopup tooltip={tooltip} class="presence">
          Content
        </TooltipPopup>
      ) : null}
      {family === 'select' ? (
        <SelectPopup select={select} class="presence">
          Content
        </SelectPopup>
      ) : null}
      {family === 'combobox' ? (
        <ComboboxPopup combobox={combobox} class="presence">
          Content
        </ComboboxPopup>
      ) : null}
      {family === 'collapsible' ? (
        <CollapsiblePanel collapsible={collapsible} class="presence">
          Content
        </CollapsiblePanel>
      ) : null}
      {family === 'accordion' ? (
        <AccordionPanel accordion={accordion} value="one" class="presence">
          Content
        </AccordionPanel>
      ) : null}
      {family === 'context' ? (
        <ContextMenuPopup menu={context} class="presence">
          Content
        </ContextMenuPopup>
      ) : null}
      {family === 'navigation' ? (
        <NavigationMenuPositioner navigationMenu={navigation} class="presence">
          <NavigationMenuPopup>
            <NavigationMenuViewport>
              <NavigationMenuContent navigationMenu={navigation} value="one">
                Content
              </NavigationMenuContent>
            </NavigationMenuViewport>
          </NavigationMenuPopup>
        </NavigationMenuPositioner>
      ) : null}
      {family === 'toast'
        ? observe(manager.source, (state) =>
            list(entities(state.toasts), (toast) => (
              <ToastRoot manager={manager} toast={toast} class="presence">
                Content
              </ToastRoot>
            )),
          )
        : null}
      {family === 'styledDialog'
        ? observe(owner.source, (state) => (
            <Dialog open={state.open} class="presence" title="Presence">
              Content
            </Dialog>
          ))
        : null}
      {family === 'sheet'
        ? observe(owner.source, (state) => (
            <Sheet open={state.open} class="presence" title="Presence">
              Content
            </Sheet>
          ))
        : null}
    </>
  ));
  const mounted = mount(host, Part, {});
  return () => {
    mounted.dispose();
    owner.dispose();
  };
}
