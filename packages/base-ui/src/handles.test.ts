import { expect, expectTypeOf, it } from 'vitest';
import { createDialog } from './dialog.js';
import { createCheckbox } from './checkbox.js';
import { createTabs } from './tabs.js';
import { createToggleGroup } from './toggle-group.js';
import { createMenu } from './menu.js';

it('exposes only family state and actions at runtime and in types', () => {
  const dialog = createDialog();
  const checkbox = createCheckbox();
  expectTypeOf(dialog.source.model()).not.toHaveProperty('checked');
  expectTypeOf(dialog).not.toHaveProperty('setChecked');
  expectTypeOf(checkbox.source.model()).not.toHaveProperty('open');
  expectTypeOf(checkbox).not.toHaveProperty('setOpen');
  expect(Object.keys(dialog.source.model()).sort()).toEqual(['disabled', 'open']);
  expect(checkbox.source.model()).not.toHaveProperty('value');
  dialog.lifetime.dispose();
  checkbox.lifetime.dispose();
});
it('keeps live configuration and controlled selection requests', () => {
  const tabs = createTabs();
  tabs.configure({ orientation: 'vertical' });
  expect(tabs.orientation).toBe('vertical');
  const group = createToggleGroup();
  group.configure({ multiple: true });
  group.toggleValue('a');
  group.toggleValue('b');
  expect(group.source.model().values).toEqual(['a', 'b']);
  const requests: string[] = [];
  const menu = createMenu({ value: 'a', onValueChange: (value) => requests.push(value) });
  menu.setValue('b');
  expect(requests).toEqual(['b']);
  expect(menu.source.model().value).toBe('a');
  menu.sync({ value: 'b', open: true });
  expect(menu.source.model()).toMatchObject({ value: 'b', open: true });
  tabs.lifetime.dispose();
  group.lifetime.dispose();
  menu.lifetime.dispose();
});
