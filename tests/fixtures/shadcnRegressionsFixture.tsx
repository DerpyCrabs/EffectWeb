import { view } from 'effectweb';
import { renderView } from 'effectweb/testing';
import { createDrawer, createMenu } from '@effectweb/base-ui';
import {
  Collapsible,
  DropdownMenu,
  HoverCard,
  Tabs,
  Sheet,
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  DrawerOverlay,
  MenubarCheckboxItem,
  MenubarRadioItem,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../packages/shadcn/src/index';
import './shadcn.css';
const Trigger = view<{ readonly id: string }>((props) => <button id={props.id}>{props.id}</button>);
export const log: string[] = [];
let receive: (family: string, controlled: boolean) => void;
export function setControlled(family: string, controlled: boolean) {
  receive(family, controlled);
}
export function mountShadcnRegressions(host: HTMLElement) {
  const section = (id: string) => {
    const element = document.createElement('section');
    element.id = id;
    host.append(element);
    return element;
  };
  const collProps = {
    trigger: <span id="coll-trigger">coll-trigger</span>,
    children: <p id="coll-panel">Content</p>,
    onOpenChange: (value: boolean) => log.push(`coll:${value}`),
  };
  const coll = renderView(section('coll'), Collapsible, {
    ...collProps,
    open: undefined as boolean | undefined,
  });
  const menuProps = {
    trigger: <Trigger id="menu-trigger" />,
    items: [{ kind: 'item' as const, label: 'Action', onSelect: () => {} }],
    onOpenChange: (value: boolean) => log.push(`menu:${value}`),
  };
  const menu = renderView(section('menu'), DropdownMenu, {
    ...menuProps,
    open: undefined as boolean | undefined,
  });
  const hoverProps = {
    trigger: <Trigger id="hover-trigger" />,
    children: <button id="hover-content">Preview</button>,
    openDelay: 100,
    closeDelay: 50,
    onOpenChange: (value: boolean) => log.push(`hover:${value}`),
  };
  const hover = renderView(section('hover'), HoverCard, {
    ...hoverProps,
    open: undefined as boolean | undefined,
  });
  const tabsProps = {
    items: [
      { value: 'a', label: 'Tab A', content: 'Panel A' },
      { value: 'b', label: 'Tab B', content: 'Panel B' },
    ],
    defaultValue: 'a',
    onValueChange: (value: string) => log.push(`tabs:${value}`),
  };
  const tabs = renderView(section('tabs'), Tabs, {
    ...tabsProps,
    value: undefined as string | undefined,
  });
  receive = (family, controlled) => {
    if (family === 'coll') coll.update({ ...collProps, open: controlled ? false : undefined });
    if (family === 'menu') menu.update({ ...menuProps, open: controlled ? false : undefined });
    if (family === 'hover') hover.update({ ...hoverProps, open: controlled ? false : undefined });
    if (family === 'tabs') tabs.update({ ...tabsProps, value: controlled ? 'a' : undefined });
  };
  const probe = document.createElement('div');
  probe.id = 'dark-probe';
  probe.className = 'block dark:hidden';
  host.append(probe);
  const sheet = renderView(section('sheet'), Sheet, { open: false, title: 'Full height' });
  const openSheet = document.createElement('button');
  openSheet.id = 'open-sheet';
  openSheet.textContent = 'Sheet';
  openSheet.onclick = () => sheet.update({ open: true, title: 'Full height' });
  host.append(openSheet);
  const drawerProps = {
    title: 'Drawer title',
    description: 'Drawer description',
    footer: 'Footer',
    onOpenChange: (open: boolean) => drawer.update({ ...drawerProps, open }),
  };
  const drawer = renderView(section('drawer'), Drawer, {
    ...drawerProps,
    open: false,
    title: 'Drawer title',
    description: 'Drawer description',
    footer: 'Footer',
  });
  const openDrawer = document.createElement('button');
  openDrawer.id = 'open-drawer';
  openDrawer.textContent = 'Drawer';
  openDrawer.onclick = () =>
    drawer.update({
      ...drawerProps,
      open: true,
      title: 'Drawer title',
      description: 'Drawer description',
      footer: 'Footer',
    });
  host.append(openDrawer);
  let selected = 'a';
  const radioProps = () => ({
    trigger: <Trigger id="radio-trigger" />,
    items: [
      {
        kind: 'radio' as const,
        value: 'a',
        label: 'Radio A',
        checked: selected === 'a',
        onSelect: () => {
          selected = 'a';
          radios.update(radioProps());
        },
      },
      {
        kind: 'radio' as const,
        value: 'b',
        label: 'Radio B',
        checked: selected === 'b',
        onSelect: () => {
          selected = 'b';
          radios.update(radioProps());
        },
      },
      { kind: 'separator' as const },
      { kind: 'radio' as const, value: 'c', label: 'Radio C', checked: true, onSelect: () => {} },
    ],
  });
  const radios = renderView(section('radios'), DropdownMenu, radioProps());
  const indicatorMenu = createMenu({ value: 'chosen' });
  const IndicatorParts = view(() => (
    <>
      <MenubarCheckboxItem menu={indicatorMenu} checked>
        Check
      </MenubarCheckboxItem>
      <MenubarRadioItem menu={indicatorMenu} value="chosen">
        Radio
      </MenubarRadioItem>
    </>
  ));
  const indicators = renderView(section('indicators'), IndicatorParts, {});
  const drawerHandle = createDrawer();
  const parent = createMenu();
  const submenu = createMenu({ parent });
  const Parts = view(() => (
    <>
      <DrawerTrigger drawer={drawerHandle}>Split drawer</DrawerTrigger>
      <DrawerOverlay drawer={drawerHandle} />
      <DrawerContent drawer={drawerHandle} direction="left">
        <DrawerHeader>
          <DrawerTitle drawer={drawerHandle}>Split title</DrawerTitle>
          <DrawerDescription drawer={drawerHandle}>Split description</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose drawer={drawerHandle}>Close split</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
      <DropdownMenuSubTrigger menu={parent} submenu={submenu}>
        Submenu
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent menu={submenu}>Sub content</DropdownMenuSubContent>
    </>
  ));
  const parts = renderView(section('parts'), Parts, {});
  return {
    dispose: () => {
      for (const mounted of [coll, menu, hover, tabs, sheet, drawer, radios, indicators, parts])
        mounted.dispose();
      for (const handle of [indicatorMenu, drawerHandle, parent, submenu])
        handle.lifetime.dispose();
    },
  };
}
