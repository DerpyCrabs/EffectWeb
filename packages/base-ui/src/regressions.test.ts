import { afterEach, expect, it, vi } from 'vitest';
import { createOverlay } from './overlay.js';
import { createMenubar } from './menubar.js';
import { parseNumber } from './numeric.js';
import { createSlider } from './slider.js';
import { createSelect } from './select.js';
import { createCheckedController, createValueController } from './controller.js';

afterEach(() => vi.useRealTimers());
it.each(['parent', 'switch', 'tree', 'setOpen', 'sync', 'toggle'])(
  'cancels delayed child opening on %s dismissal',
  (path) => {
    vi.useFakeTimers();
    const bar = createMenubar();
    const parent = bar.createMenu();
    const other = bar.createMenu();
    const child = createOverlay({ parent, delay: 100 });
    bar.open(parent);
    child.showDelayed();
    if (path === 'parent') parent.hide();
    if (path === 'switch') bar.open(other);
    if (path === 'tree') child.closeTree();
    if (path === 'setOpen') child.setOpen(false);
    if (path === 'sync') child.sync({ open: false });
    if (path === 'toggle') parent.toggle();
    vi.advanceTimersByTime(100);
    expect(child.source.model().open).toBe(false);
    child.lifetime.dispose();
    bar.lifetime.dispose();
  },
);
it('never opens a delayed child under a closed parent', () => {
  vi.useFakeTimers();
  const parent = createOverlay();
  const child = createOverlay({ parent, delay: 100 });
  child.showDelayed();
  vi.advanceTimersByTime(100);
  expect(child.source.model().open).toBe(false);
  child.lifetime.dispose();
  parent.lifetime.dispose();
});
it('disabled menubars ignore open and hover requests', () => {
  const bar = createMenubar({ disabled: true });
  const first = bar.createMenu();
  const second = bar.createMenu();
  bar.open(first);
  expect(first.source.model().open).toBe(false);
  first.sync({ open: true });
  bar.hover(second);
  expect(second.source.model().open).toBe(false);
  bar.lifetime.dispose();
});
it('parses fractional localized percentages', () => {
  expect(parseNumber('12,5 %', 'de-DE', { style: 'percent', maximumFractionDigits: 3 })).toBe(
    0.125,
  );
});
it('allows changing the number of slider thumbs with an unchanged prefix', () => {
  const slider = createSlider({ defaultValues: [20, 80] });
  slider.setValues([20]);
  expect(slider.source.model().values).toEqual([20]);
  slider.lifetime.dispose();
});
it('selects empty strings and reserves null for absence', () => {
  const select = createSelect({ defaultValue: '' });
  expect(select.values()).toEqual(['']);
  expect(select.selected('')).toBe(true);
  select.setValue(null);
  expect(select.values()).toEqual([]);
  select.lifetime.dispose();
});
it('publishes configuration changes through the observed source', () => {
  const handle = createValueController();
  const listener = vi.fn();
  const stop = handle.source.subscribe(listener);
  handle.configure({ orientation: 'vertical', multiple: true });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(handle.orientation).toBe('vertical');
  expect(handle.multiple).toBe(true);
  stop();
  handle.lifetime.dispose();
});

it('uncontrolled resets restore initial values and clear interaction state even when disabled', () => {
  const checked = createCheckedController({ defaultChecked: true, indeterminate: true });
  const value = createValueController({ defaultValue: 'a' });
  checked.setChecked(false);
  value.setValue('b');
  checked.sync({ disabled: true });
  value.sync({ disabled: true });
  checked.reset();
  value.reset();
  expect(checked.source.model()).toEqual({
    checked: true,
    indeterminate: true,
    disabled: true,
    dirty: false,
  });
  expect(value.source.model()).toEqual({ value: 'a', disabled: true, dirty: false });
  checked.lifetime.dispose();
  value.lifetime.dispose();
});
it('controlled resets request captured initial values without mutating parent state', () => {
  const checkedChange = vi.fn();
  const valueChange = vi.fn();
  const checked = createCheckedController({ checked: true, onCheckedChange: checkedChange });
  const value = createValueController({ value: 'a', onValueChange: valueChange });
  checked.sync({ checked: false });
  value.sync({ value: 'b' });
  checked.reset();
  value.reset();
  expect(checkedChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(valueChange).toHaveBeenCalledExactlyOnceWith('a');
  expect(checked.source.model().checked).toBe(false);
  expect(value.source.model().value).toBe('b');
  checked.lifetime.dispose();
  value.lifetime.dispose();
});
