// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import {
  createDialog,
  createSelect,
  createAccordion,
  createTabs,
  createRadioGroup,
  createToggleGroup,
  createCollapsible,
  createAvatar,
  createMenu,
} from '@effectweb/base-ui';
import { renderView } from 'effectweb/testing';
import { overlayAdapter } from './adapter.js';
import { PopoverTitle, PopoverDescription } from './popover.js';
import { Checkbox } from './checkbox.js';
import { Switch } from './switch.js';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
} from './avatar.js';
import { SelectTrigger } from './select.js';
import { AccordionItem, AccordionTrigger, AccordionContent } from './accordion.js';
import { TabsList, TabsTrigger, TabsContent } from './tabs.js';
import { RadioGroupItem } from './radio-group.js';
import { ToggleGroupItem } from './toggle-group.js';
import { CollapsibleTrigger, CollapsibleContent } from './collapsible.js';
import * as Menu from './dropdown-menu.js';
const cleanups: Array<() => void> = [];
const host = () => {
  const element = document.createElement('div');
  document.body.append(element);
  cleanups.push(() => element.remove());
  return element;
};
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
it('overlay receives controlled state and updated callbacks', () => {
  const requests: string[] = [];
  type Props = { open?: boolean | undefined; onOpenChange: (open: boolean) => void };
  const adapter = overlayAdapter<Props>(
    { onOpenChange: (open) => requests.push(`first:${open}`) },
    createDialog,
  );
  adapter.handle.setOpen(true);
  expect(adapter.handle.source.model().open).toBe(true);
  adapter.receive({ open: false, onOpenChange: (open) => requests.push(`second:${open}`) });
  adapter.handle.setOpen(true);
  expect(adapter.handle.source.model().open).toBe(false);
  expect(requests).toEqual(['first:true', 'second:true']);
  adapter.receive({ onOpenChange: () => {} });
  adapter.handle.setOpen(true);
  expect(adapter.handle.source.model().open).toBe(true);
  adapter.lifetime.dispose();
});
it('popover text parts forward native popover attributes to the DOM', () => {
  const titleHost = host();
  const descriptionHost = host();
  cleanups.push(
    renderView(titleHost, PopoverTitle, { popover: 'auto', children: 'Title' }).dispose,
  );
  cleanups.push(
    renderView(descriptionHost, PopoverDescription, { popover: 'manual', children: 'Description' })
      .dispose,
  );
  expect(titleHost.querySelector('h3')?.getAttribute('popover')).toBe('auto');
  expect(descriptionHost.querySelector('p')?.getAttribute('popover')).toBe('manual');
});
it.each([
  ['checkbox', Checkbox],
  ['switch', Switch],
] as const)('%s calls both change handlers unless the native event is canceled', (_name, Part) => {
  const element = host();
  const calls: string[] = [];
  const rendered = renderView(element, Part, {
    checked: false,
    onChange: (_event: Event): void => {
      calls.push('native');
    },
    onCheckedChange: (value) => calls.push(`checked:${value}`),
  });
  cleanups.push(rendered.dispose);
  const input = element.querySelector('input')!;
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  expect(calls).toEqual(['native', 'checked:true']);
  rendered.update({
    checked: false,
    onChange: (event) => {
      calls.push('canceled');
      event.preventDefault();
    },
    onCheckedChange: () => calls.push('unexpected'),
  });
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  expect(calls).toEqual(['native', 'checked:true', 'canceled']);
});
it('avatar shows its fallback after a loaded source is removed', () => {
  const element = host();
  const rendered = renderView(element, Avatar, {
    src: '/avatar.png' as string | undefined,
    fallback: 'AB',
  });
  cleanups.push(rendered.dispose);
  element.querySelector('img')!.dispatchEvent(new Event('load'));
  expect(element.querySelector<HTMLElement>('[data-slot=avatar-fallback]')!.hidden).toBe(true);
  rendered.update({ src: undefined, fallback: 'AB' });
  expect(element.querySelector('img')).toBeNull();
  expect(element.querySelector<HTMLElement>('[data-slot=avatar-fallback]')!.hidden).toBe(false);
  const root = element.querySelector('[data-slot=avatar]')!;
  expect(root.classList.contains('overflow-hidden')).toBe(false);
  expect(root.classList.contains('after:border-border')).toBe(true);
  expect(
    element
      .querySelector('[data-slot=avatar-fallback]')!
      .classList.contains('text-muted-foreground'),
  ).toBe(true);
});
it('select trigger defaults its size and supports small triggers', () => {
  const select = createSelect();
  cleanups.push(() => select.lifetime.dispose());
  const element = host();
  const rendered = renderView(element, SelectTrigger, {
    select,
    size: undefined as 'default' | 'sm' | undefined,
  });
  cleanups.push(rendered.dispose);
  expect(element.querySelector('button')?.getAttribute('data-size')).toBe('default');
  rendered.update({ select, size: 'sm' });
  expect(element.querySelector('button')?.getAttribute('data-size')).toBe('sm');
});
it('exports styled composition parts with family slots and shared handles', () => {
  const accordion = createAccordion({ defaultValues: ['a'] });
  const tabs = createTabs({ defaultValue: 'a' });
  const radioGroup = createRadioGroup({ defaultValue: 'a' });
  const toggleGroup = createToggleGroup();
  const collapsible = createCollapsible({ defaultOpen: true });
  const avatar = createAvatar();
  const menu = createMenu();
  for (const handle of [accordion, tabs, radioGroup, toggleGroup, collapsible, avatar, menu])
    cleanups.push(() => handle.lifetime.dispose());
  const element = host();
  const mounts = [
    renderView(element.appendChild(document.createElement('div')), AccordionItem, {
      accordion,
      value: 'a',
    }),
    renderView(element.appendChild(document.createElement('div')), AccordionTrigger, {
      accordion,
      value: 'a',
      children: 'Accordion',
    }),
    renderView(element.appendChild(document.createElement('div')), AccordionContent, {
      accordion,
      value: 'a',
      children: 'Panel',
    }),
    renderView(element.appendChild(document.createElement('div')), TabsList, { tabs }),
    renderView(element.appendChild(document.createElement('div')), TabsTrigger, {
      tabs,
      value: 'a',
    }),
    renderView(element.appendChild(document.createElement('div')), TabsContent, {
      tabs,
      value: 'a',
    }),
    renderView(element.appendChild(document.createElement('div')), RadioGroupItem, {
      radioGroup,
      value: 'a',
    }),
    renderView(element.appendChild(document.createElement('div')), ToggleGroupItem, {
      toggleGroup,
      value: 'a',
    }),
    renderView(element.appendChild(document.createElement('div')), CollapsibleTrigger, {
      collapsible,
    }),
    renderView(element.appendChild(document.createElement('div')), CollapsibleContent, {
      collapsible,
    }),
    renderView(element.appendChild(document.createElement('div')), AvatarImage, { avatar }),
    renderView(element.appendChild(document.createElement('div')), AvatarFallback, { avatar }),
    renderView(element.appendChild(document.createElement('div')), AvatarBadge, {}),
    renderView(element.appendChild(document.createElement('div')), AvatarGroup, {}),
    renderView(element.appendChild(document.createElement('div')), AvatarGroupCount, {}),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuTrigger, {
      menu,
    }),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuItem, { menu }),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuCheckboxItem, {
      menu,
      checked: true,
    }),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuRadioItem, {
      menu,
      value: 'a',
    }),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuRadioGroup, {}),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuLabel, {}),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuSeparator, {}),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuShortcut, {}),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuGroup, {}),
    renderView(element.appendChild(document.createElement('div')), Menu.DropdownMenuSub, {}),
  ];
  cleanups.push(...mounts.map((mounted) => mounted.dispose));
  for (const slot of [
    'accordion-item',
    'accordion-trigger',
    'accordion-content',
    'tabs-list',
    'tabs-trigger',
    'tabs-content',
    'radio-group-item',
    'toggle-group-item',
    'collapsible-trigger',
    'collapsible-content',
    'avatar-image',
    'avatar-fallback',
    'avatar-badge',
    'avatar-group',
    'avatar-group-count',
    'dropdown-menu-trigger',
    'dropdown-menu-item',
    'dropdown-menu-checkbox-item',
    'dropdown-menu-radio-item',
    'dropdown-menu-radio-group',
    'dropdown-menu-label',
    'dropdown-menu-separator',
    'dropdown-menu-shortcut',
    'dropdown-menu-group',
    'dropdown-menu-sub',
  ])
    expect(element.querySelector(`[data-slot=${slot}]`), slot).not.toBeNull();
  expect(element.querySelector('h3 > [data-slot=accordion-trigger]')).not.toBeNull();
  expect(element.querySelector('[data-slot=radio-group-indicator]')).not.toBeNull();
});
