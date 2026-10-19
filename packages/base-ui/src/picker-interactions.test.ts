// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { mount, modelOwner } from 'effectweb';
import { ComboboxItem, createCombobox } from './combobox.js';
import { createPopover, popoverHoverBinding } from './popover.js';
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
it('keeps explicit option IDs in keyboard focus and skips disabled mounted options', async () => {
  const combo = createCombobox({ items: ['first', 'second'], defaultOpen: true });
  const host = document.createElement('div');
  document.body.append(host);
  const state = modelOwner({
    combobox: combo,
    value: 'first',
    id: 'editor-option-first',
    disabled: true,
  });
  const first = mount(host, ComboboxItem, state.source);
  const second = mount(host, ComboboxItem, { combobox: combo, value: 'second' });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(combo.itemId('first')).toBe('editor-option-first');
  host.querySelector<HTMLElement>('#editor-option-first')!.click();
  expect(combo.source.model().value).toBeNull();
  combo.key(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
  expect(combo.inputSource.model().activeIndex).toBe(1);
  state.patch({ disabled: false });
  combo.key(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }));
  expect(combo.inputSource.model().activeIndex).toBe(0);
  first.dispose();
  expect(combo.itemId('first')).not.toBe('editor-option-first');
  second.dispose();
  state.dispose();
  combo.lifetime.dispose();
});
it('keeps hovered popovers open across the trigger-popup gap and cancels disposed timers', () => {
  vi.useFakeTimers();
  const popover = createPopover();
  const trigger = document.createElement('button'),
    popup = document.createElement('div');
  document.body.append(trigger, popup);
  popover.attachPopup(popup);
  const props = { popover, openOnHover: true, delay: 150, closeDelay: 150 };
  const binding = popoverHoverBinding(props);
  const work = binding.acquire(trigger, () => props);
  if (!work || typeof work !== 'object' || !('dispose' in work))
    throw new Error('missing lifecycle');
  trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  vi.advanceTimersByTime(150);
  expect(popover.source.model().open).toBe(true);
  trigger.dispatchEvent(new PointerEvent('pointerleave', { relatedTarget: document.body }));
  popup.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  vi.advanceTimersByTime(150);
  expect(popover.source.model().open).toBe(true);
  popup.dispatchEvent(
    new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
  );
  vi.advanceTimersByTime(150);
  expect(popover.source.model().open).toBe(false);
  trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  work.dispose();
  vi.advanceTimersByTime(150);
  expect(popover.source.model().open).toBe(false);
  popover.lifetime.dispose();
});
it('keeps a combobox query and focus when item-press closing is canceled', async () => {
  const input = document.createElement('input');
  const host = document.createElement('div');
  document.body.append(input, host);
  const selected = vi.fn();
  const causes: Event[] = [];
  const combo = createCombobox({
    items: ['alpha', 'alpine'],
    defaultOpen: true,
    defaultInputValue: 'al',
    onValueChange: selected,
    onOpenChange(open, details) {
      if (!open && details.reason === 'item-press') {
        causes.push(details.event);
        details.cancel();
      }
    },
  });
  const mounted = mount(host, ComboboxItem, { combobox: combo, value: 'alpha' });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  input.focus();
  host.querySelector<HTMLElement>('[role="option"]')!.click();
  expect(selected).toHaveBeenLastCalledWith('alpha');
  expect(combo.source.model().open).toBe(true);
  expect(combo.inputSource.model().inputValue).toBe('al');
  expect(document.activeElement).toBe(input);
  expect(causes[0]).toBeInstanceOf(MouseEvent);
  combo.highlight(1);
  const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  combo.key(enter);
  expect(selected).toHaveBeenLastCalledWith('alpine');
  expect(causes[1]).toBe(enter);
  expect(combo.inputSource.model().inputValue).toBe('al');
  mounted.dispose();
  combo.lifetime.dispose();
});
it('keeps checkbox menus open by default and supports closing on selection', async () => {
  const { createMenu, MenuCheckboxItem } = await import('./menu.js');
  const menu = createMenu({ defaultOpen: true });
  const host = document.createElement('div');
  document.body.append(host);
  const toggle = vi.fn();
  const props = modelOwner({ menu, checked: false, closeOnClick: false, onCheckedChange: toggle });
  const mounted = mount(host, MenuCheckboxItem, props.source);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  host.querySelector<HTMLElement>('button')!.click();
  expect(toggle).toHaveBeenCalledWith(true);
  expect(menu.source.model().open).toBe(true);
  props.patch({ closeOnClick: true });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  host.querySelector<HTMLElement>('button')!.click();
  expect(menu.source.model().open).toBe(false);
  mounted.dispose();
  props.dispose();
  menu.lifetime.dispose();
});
