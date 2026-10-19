import { expect, it } from 'vitest';
import { createMenu, createMenuRadioGroup } from './menu.js';

it('independent controlled radio groups request changes without mutating each other', () => {
  const changes: string[] = [];
  const mode = createMenuRadioGroup({
    value: 'chat',
    onValueChange: (value) => changes.push(value),
  });
  const access = createMenuRadioGroup({ defaultValue: 'sandbox' });
  const menu = createMenu({ defaultOpen: true });
  mode.setValue('chat');
  expect(changes).toEqual([]);
  mode.setValue('plan');
  expect(changes).toEqual(['plan']);
  expect(mode.source.model().value).toBe('chat');
  mode.sync({ value: 'plan' });
  mode.setValue('plan');
  expect(changes).toEqual(['plan']);
  access.setValue('full');
  expect(mode.source.model().value).toBe('plan');
  expect(access.source.model().value).toBe('full');
  access.sync({ disabled: true });
  access.setValue('sandbox');
  expect(access.source.model().value).toBe('full');
  expect(menu.source.model().open).toBe(true);
  menu.closeTree();
  expect(menu.source.model().open).toBe(false);
  mode.lifetime.dispose();
  access.lifetime.dispose();
  menu.lifetime.dispose();
});
