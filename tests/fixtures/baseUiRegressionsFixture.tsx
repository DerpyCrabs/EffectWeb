import { mount, modelOwner, observe, view } from 'effectweb';
import {
  createCheckbox,
  CheckboxRoot,
  createSwitch,
  SwitchRoot,
  createRadioGroup,
  RadioInput,
  RadioGroupRoot,
  createTabs,
  TabsList,
  TabsTab,
  createToolbar,
  ToolbarRoot,
  createNavigationMenu,
  NavigationMenuTrigger,
  NavigationMenuContent,
  createMenubar,
  MenubarTrigger,
  createMenu,
  MenuItem,
  MenuSubmenuTrigger,
  createTooltip,
  TooltipTrigger,
  createCombobox,
  ComboboxInput,
  ComboboxChip,
  createScrollArea,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  createField,
  FieldControl,
  FieldDescription,
  FieldError,
} from '../../packages/base-ui/src/index.js';

export function mountBaseUiRegressionsFixture(host: HTMLElement) {
  const owner = modelOwner({
    value: 'first',
    alternate: false,
    descriptions: false,
    errors: false,
    calls: '',
  });
  const checkbox = createCheckbox({ defaultChecked: true, indeterminate: true });
  const switchControl = createSwitch({ defaultChecked: true });
  const radio = createRadioGroup({ defaultValue: 'a' });
  const controlled = createCheckbox({
    checked: true,
    onCheckedChange: (value) => owner.patch({ calls: `checked:${value}` }),
  });
  const controlledRadio = createRadioGroup({
    value: 'a',
    onValueChange: (value) => owner.patch({ calls: `radio:${value}` }),
  });
  const tabs = createTabs({ defaultValue: 'a' });
  const toolbar = createToolbar();
  const first = createNavigationMenu();
  const second = createNavigationMenu();
  const bar = createMenubar({ disabled: true });
  const menu = bar.createMenu();
  const parent = createMenu({ defaultOpen: true });
  const child = createMenu({ parent });
  const tooltip = createTooltip();
  const combo = createCombobox({
    multiple: true,
    defaultValue: ['red', 'blue'],
    items: ['red', 'blue'],
  });
  const scroll = createScrollArea({ visibility: 'always' });
  const field = createField({ invalid: true });
  for (const handle of [
    checkbox,
    switchControl,
    radio,
    controlled,
    controlledRadio,
    tabs,
    toolbar,
    first,
    second,
    bar,
    parent,
    child,
    tooltip,
    combo,
    scroll,
    field,
  ])
    owner.own(handle.lifetime);
  const prevent = (event: Event) => {
    owner.patch({ calls: event.type });
    event.preventDefault();
  };
  const Page = view(() => (
    <main>
      <form id="reset-form">
        <CheckboxRoot checkbox={checkbox} aria-label="Reset checkbox" />
        <SwitchRoot switch={switchControl} aria-label="Reset switch" />
        <RadioInput radioGroup={radio} value="a" aria-label="Reset radio a" />
        <RadioInput radioGroup={radio} value="b" aria-label="Reset radio b" />
        <CheckboxRoot checkbox={controlled} aria-label="Controlled checkbox" />
        <RadioInput radioGroup={controlledRadio} value="a" aria-label="Controlled radio a" />
        <RadioInput radioGroup={controlledRadio} value="b" aria-label="Controlled radio b" />
        <button type="reset">Reset</button>
      </form>
      <button
        onClick={() => {
          controlled.sync({ checked: false });
          controlledRadio.sync({ value: 'b' });
        }}
      >
        Sync controlled
      </button>
      <button
        onClick={() => {
          checkbox.lifetime.dispose();
          switchControl.lifetime.dispose();
          radio.lifetime.dispose();
        }}
      >
        Dispose controls
      </button>
      <TabsList tabs={tabs} aria-label="Mutable tabs">
        <TabsTab tabs={tabs} value="a">
          Tab A
        </TabsTab>
        <TabsTab tabs={tabs} value="b">
          Tab B
        </TabsTab>
      </TabsList>
      <RadioGroupRoot radioGroup={radio} aria-label="Orientation radio" />
      <ToolbarRoot toolbar={toolbar} aria-label="Orientation toolbar" />
      <button
        onClick={() => {
          tabs.configure({ orientation: 'vertical' });
          radio.configure({ orientation: 'vertical' });
          toolbar.configure({ orientation: 'vertical' });
        }}
      >
        Configure
      </button>
      {observe(owner.source, (state) => (
        <>
          <NavigationMenuTrigger
            navigationMenu={state.alternate ? second : first}
            value={state.value}
          >
            Mutable navigation
          </NavigationMenuTrigger>
          <NavigationMenuContent
            navigationMenu={state.alternate ? second : first}
            value={state.value}
          >
            Mutable content
          </NavigationMenuContent>
          <output id="calls">{state.calls}</output>
          {state.descriptions ? (
            <FieldDescription field={field}>Description</FieldDescription>
          ) : null}
          {state.errors ? <FieldError field={field}>Error</FieldError> : null}
        </>
      ))}
      <button onClick={() => owner.patch({ value: 'second' })}>Change value</button>
      <button onClick={() => owner.patch({ alternate: true })}>Change handle</button>
      <button
        onClick={() => {
          first.hide();
          second.show('second');
        }}
      >
        Show second handle
      </button>
      <button
        onClick={() => {
          second.hide();
          first.show('second');
        }}
      >
        Show old handle
      </button>
      <MenubarTrigger menubar={bar} menu={menu}>
        Disabled menu
      </MenubarTrigger>
      <button onClick={() => bar.sync({ disabled: false })}>Enable bar</button>
      <MenuItem menu={parent} onPointerMove={prevent}>
        Prevent item focus
      </MenuItem>
      <MenuSubmenuTrigger menu={parent} submenu={child} onPointerEnter={prevent} onClick={prevent}>
        Prevent submenu
      </MenuSubmenuTrigger>
      <TooltipTrigger
        tooltip={tooltip}
        onPointerEnter={prevent}
        onPointerLeave={prevent}
        onFocus={prevent}
        onBlur={prevent}
        onKeyDown={prevent}
      >
        Prevent tooltip
      </TooltipTrigger>
      <button onClick={() => tooltip.setOpen(true)}>Show tooltip state</button>
      <ComboboxInput combobox={combo} aria-label="Chip input" />
      <ComboboxChip combobox={combo} value="red">
        Red chip
      </ComboboxChip>
      <ComboboxChip combobox={combo} value="blue">
        Blue chip
      </ComboboxChip>
      <ScrollAreaRoot scrollArea={scroll} dir="rtl" style={{ width: '300px', height: '100px' }}>
        <ScrollAreaViewport
          scrollArea={scroll}
          data-testid="rtl-viewport"
          style={{ width: '300px', height: '90px' }}
        >
          <div style={{ width: '1200px', height: '60px' }}>Wide content</div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar scrollArea={scroll} orientation="horizontal" data-testid="rtl-track">
          <ScrollAreaThumb scrollArea={scroll} orientation="horizontal" data-testid="rtl-thumb" />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
      <FieldControl field={field} aria-label="Described input" aria-describedby="caller-help" />
      <p id="caller-help">Caller help</p>
      <button onClick={() => owner.edit('descriptions', (value) => !value)}>
        Toggle description
      </button>
      <button onClick={() => owner.edit('errors', (value) => !value)}>Toggle error</button>
      <button id="outside">Outside</button>
    </main>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
    first,
    second,
    checkbox,
    switchControl,
    radio,
    controlled,
    controlledRadio,
  };
}
