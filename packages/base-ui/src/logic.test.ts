import { describe, expect, it, vi } from 'vitest';
import { nextIndex, createTypeahead } from './collection.js';
import { place } from './positioning.js';
import {
  createOpenController,
  createValuesController,
  createCheckedController,
} from './controller.js';
describe('roving focus', () => {
  it('handles empty, unselected, wrap, ends and orientation', () => {
    expect(nextIndex(0, -1, 'ArrowDown')).toBeNull();
    expect(nextIndex(3, -1, 'ArrowUp')).toBe(2);
    expect(nextIndex(3, 2, 'ArrowDown')).toBe(0);
    expect(nextIndex(3, 2, 'ArrowDown', 'vertical', false)).toBe(2);
    expect(nextIndex(3, 1, 'Home')).toBe(0);
    expect(nextIndex(3, 1, 'End')).toBe(2);
    expect(nextIndex(3, 1, 'ArrowRight', 'horizontal')).toBe(2);
    expect(nextIndex(3, 1, 'ArrowRight')).toBeNull();
  });
});
describe('typeahead', () => {
  it('cycles repeated letters, supports prefixes and resets after a pause', () => {
    const find = createTypeahead();
    const labels = ['Apple', 'Apricot', 'Banana'];
    expect(find(labels, 0, 'a', 0)).toBe(1);
    expect(find(labels, 1, 'a', 20)).toBe(0);
    expect(find(labels, 0, 'b', 1000)).toBe(2);
    expect(find(labels, 2, 'a', 1100)).toBe(2);
    expect(find(labels, 2, 'x', 2000)).toBeNull();
  });
});
it('positioning flips and shifts with alignment offsets', () => {
  expect(
    place(
      { x: 90, y: 90, width: 10, height: 10 },
      { x: 0, y: 0, width: 30, height: 20 },
      { x: 0, y: 0, width: 100, height: 100 },
      { side: 'bottom', align: 'start', offset: 4, alignOffset: 8 },
    ),
  ).toEqual({ x: 70, y: 66, side: 'top' });
});
it('handles publish independently and disposal stops observations', () => {
  const first = createOpenController();
  const second = createOpenController();
  const observer = vi.fn();
  first.lifetime.own(first.source.subscribe(observer));
  first.toggle();
  expect(first.source.model().open).toBe(true);
  expect(second.source.model().open).toBe(false);
  const selection = createValuesController();
  selection.toggleValue('a');
  selection.toggleValue('b');
  expect(selection.source.model().values).toEqual(['b']);
  selection.lifetime.dispose();
  first.lifetime.dispose();
  second.lifetime.dispose();
  observer.mockClear();
  first.toggle();
  expect(observer).not.toHaveBeenCalled();
});
it('controlled requests wait for parent acceptance and disabled controls ignore requests', () => {
  const requests: boolean[] = [];
  const handle = createCheckedController({
    checked: false,
    onCheckedChange: (value) => requests.push(value),
  });
  handle.setChecked(true);
  expect(requests).toEqual([true]);
  expect(handle.source.model().checked).toBe(false);
  handle.sync({ checked: true });
  expect(handle.source.model().checked).toBe(true);
  handle.sync({ disabled: true });
  handle.setChecked(false);
  expect(requests).toEqual([true]);
  handle.lifetime.dispose();
});
it('typeahead starts at the first match when no item is focused', () => {
  expect(createTypeahead()(['Apple', 'Apricot'], -1, 'a', 0)).toBe(0);
});
it('oversized popups shift within the viewport while retaining the preferred side', () => {
  expect(
    place(
      { x: 50, y: 50, width: 10, height: 10 },
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 0, y: 0, width: 100, height: 100 },
    ),
  ).toEqual({ x: 0, y: 0, side: 'bottom' });
});
it('resolves logical sides and top/bottom alignment in RTL', () => {
  const anchor = { x: 100, y: 100, width: 80, height: 20 };
  const floating = { x: 0, y: 0, width: 30, height: 10 };
  const viewport = { x: 0, y: 0, width: 500, height: 500 };
  expect(place(anchor, floating, viewport, { side: 'inline-start', dir: 'rtl' })).toMatchObject({
    side: 'right',
    x: 184,
  });
  expect(place(anchor, floating, viewport, { side: 'inline-end', dir: 'rtl' })).toMatchObject({
    side: 'left',
    x: 66,
  });
  expect(
    place(anchor, floating, viewport, {
      side: 'bottom',
      align: 'start',
      dir: 'rtl',
      alignOffset: 2,
    }),
  ).toMatchObject({ x: 148 });
});
