import { mount, modelOwner, observe, view } from 'effectweb';
import {
  createDialog,
  DialogTrigger,
  DialogPopup,
  DialogTitle,
  DialogClose,
  createAlertDialog,
  AlertDialogTrigger,
  AlertDialogPopup,
  AlertDialogClose,
  createPopover,
  PopoverTrigger,
  PopoverPopup,
  PopoverPositioner,
  PopoverArrow,
  createMenu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuSubmenuTrigger,
  MenuCheckboxItem,
  MenuRadioItem,
  createTooltip,
  TooltipTrigger,
  TooltipPopup,
  createSelect,
  SelectTrigger,
  SelectPopup,
  SelectItem,
  SelectValue,
  createTabs,
  TabsList,
  TabsTab,
  TabsPanel,
  createCollapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
  createAccordion,
  AccordionRoot,
  AccordionTrigger,
  AccordionPanel,
  createCheckbox,
  CheckboxRoot,
  createSwitch,
  SwitchRoot,
  createRadioGroup,
  RadioGroupRoot,
  RadioGroupItem,
  createToggle,
  Toggle,
  createToggleGroup,
  ToggleGroupRoot,
  ToggleGroupItem,
  createField,
  FieldRoot,
  FieldLabel,
  FieldControl,
  FieldError,
  createFieldset,
  FieldsetRoot,
  FieldsetLegend,
  createAvatar,
  AvatarImage,
  AvatarFallback,
  Separator,
  ProgressRoot,
  Input,
} from '../../packages/base-ui/src/index';

export function mountBaseUiFixture(host: HTMLElement) {
  const owner = modelOwner({});
  const dialog = createDialog();
  const alertDialog = createAlertDialog();
  const popover = createPopover();
  const menu = createMenu();
  const menuFlag = createCheckbox();
  owner.own(menuFlag.lifetime);
  const submenu = createMenu({ parent: menu });
  const tooltip = createTooltip();
  const select = createSelect({ defaultValue: 'Apple' });
  const tabs = createTabs({ defaultValue: 'one' });
  const collapsible = createCollapsible();
  const accordion = createAccordion();
  const checkbox = createCheckbox({ indeterminate: true });
  const switchControl = createSwitch();
  const radioGroup = createRadioGroup({ defaultValue: 'one' });
  const toggle = createToggle();
  const toggleGroup = createToggleGroup({ defaultValues: ['one'], multiple: true });
  const field = createField();
  const fieldset = createFieldset();
  const avatar = createAvatar();
  for (const handle of [
    dialog,
    alertDialog,
    popover,
    menu,
    submenu,
    tooltip,
    select,
    tabs,
    collapsible,
    accordion,
    checkbox,
    switchControl,
    radioGroup,
    toggle,
    toggleGroup,
    field,
    fieldset,
    avatar,
  ])
    owner.own(handle.lifetime);
  const Page = view(() => (
    <main>
      <section aria-label="triggers">
        <DialogTrigger dialog={dialog}>Open dialog</DialogTrigger>
        <AlertDialogTrigger alertDialog={alertDialog}>Open alert</AlertDialogTrigger>
        <PopoverTrigger popover={popover}>Open popover</PopoverTrigger>
        <MenuTrigger menu={menu}>Open menu</MenuTrigger>
        <TooltipTrigger tooltip={tooltip}>Help</TooltipTrigger>
        <SelectTrigger select={select} aria-label="Fruit">
          <SelectValue select={select} />
        </SelectTrigger>
      </section>
      <section aria-label="separate popups">
        <DialogPopup dialog={dialog} aria-labelledby={`${dialog.id}-title`}>
          <DialogTitle dialog={dialog}>Headless dialog</DialogTitle>
          <Input aria-label="Dialog text" />
          <DialogClose dialog={dialog}>Done</DialogClose>
        </DialogPopup>
        <AlertDialogPopup alertDialog={alertDialog} aria-label="Confirm">
          <AlertDialogClose alertDialog={alertDialog}>Cancel</AlertDialogClose>
        </AlertDialogPopup>
        <PopoverPositioner popover={popover} side="right" align="start">
          <PopoverPopup popover={popover} aria-label="Details">
            <button>Popover action</button>
            <PopoverArrow popover={popover} style={{ width: '8px', height: '8px' }} />
          </PopoverPopup>
        </PopoverPositioner>
        <MenuPopup menu={menu} aria-label="Actions">
          <MenuItem menu={menu}>Apple</MenuItem>
          <MenuItem menu={menu} disabled>
            Disabled
          </MenuItem>
          <MenuItem menu={menu}>Banana</MenuItem>
          <>
            {observe(menuFlag.source, (state) => (
              <MenuCheckboxItem
                menu={menu}
                checked={state.checked}
                onCheckedChange={menuFlag.setChecked}
              >
                Flag
              </MenuCheckboxItem>
            ))}
          </>
          <MenuRadioItem menu={menu} value="radio">
            Radio choice
          </MenuRadioItem>
          <MenuSubmenuTrigger menu={menu} submenu={submenu}>
            More
          </MenuSubmenuTrigger>
        </MenuPopup>
        <MenuPopup menu={submenu} side="right" aria-label="Submenu">
          <MenuItem menu={submenu}>Nested action</MenuItem>
        </MenuPopup>
        <TooltipPopup tooltip={tooltip} side="top">
          Help description
        </TooltipPopup>
        <SelectPopup select={select} aria-label="Fruit options">
          <SelectItem select={select} value="Apple">
            Apple
          </SelectItem>
          <SelectItem select={select} value="Apricot" disabled>
            Apricot
          </SelectItem>
          <SelectItem select={select} value="Banana">
            Banana
          </SelectItem>
          <SelectItem select={select} value="Cherry">
            Cherry
          </SelectItem>
        </SelectPopup>
      </section>
      <TabsList tabs={tabs} aria-label="Sections">
        <TabsTab tabs={tabs} value="one">
          Tab one
        </TabsTab>
        <TabsTab tabs={tabs} value="disabled" disabled>
          Disabled tab
        </TabsTab>
        <TabsTab tabs={tabs} value="two">
          Tab two
        </TabsTab>
      </TabsList>
      <TabsPanel tabs={tabs} value="one">
        First panel
      </TabsPanel>
      <TabsPanel tabs={tabs} value="two">
        Second panel
      </TabsPanel>
      <CollapsibleTrigger collapsible={collapsible}>Disclosure</CollapsibleTrigger>
      <CollapsiblePanel collapsible={collapsible}>Disclosure content</CollapsiblePanel>
      <AccordionRoot accordion={accordion}>
        <AccordionTrigger accordion={accordion} value="one">
          Section one
        </AccordionTrigger>
        <AccordionPanel accordion={accordion} value="one">
          Accordion one
        </AccordionPanel>
        <AccordionTrigger accordion={accordion} value="two">
          Section two
        </AccordionTrigger>
        <AccordionPanel accordion={accordion} value="two">
          Accordion two
        </AccordionPanel>
      </AccordionRoot>
      <CheckboxRoot checkbox={checkbox} aria-label="Check" />
      <SwitchRoot switch={switchControl} aria-label="Switch" />
      <RadioGroupRoot radioGroup={radioGroup} aria-label="Radio">
        <RadioGroupItem radioGroup={radioGroup} value="one">
          Radio one
        </RadioGroupItem>
        <RadioGroupItem radioGroup={radioGroup} value="two">
          Radio two
        </RadioGroupItem>
      </RadioGroupRoot>
      <Toggle toggle={toggle}>Bold</Toggle>
      <ToggleGroupRoot toggleGroup={toggleGroup} aria-label="Formatting">
        <ToggleGroupItem toggleGroup={toggleGroup} value="one">
          Italic
        </ToggleGroupItem>
        <ToggleGroupItem toggleGroup={toggleGroup} value="two">
          Underline
        </ToggleGroupItem>
      </ToggleGroupRoot>
      <FieldsetRoot fieldset={fieldset}>
        <FieldsetLegend>Account</FieldsetLegend>
        <FieldRoot field={field}>
          <FieldLabel field={field}>Email</FieldLabel>
          <FieldControl field={field} type="email" required />
          <FieldError field={field}>Enter an email</FieldError>
        </FieldRoot>
      </FieldsetRoot>
      <AvatarImage avatar={avatar} src="data:image/png;base64,broken" alt="Profile" />
      <AvatarFallback avatar={avatar}>AB</AvatarFallback>
      <Separator aria-label="Divider" />
      <ProgressRoot value={25} aria-label="Upload" />
      <button id="outside">Outside</button>
    </main>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
