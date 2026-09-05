import { expect, it } from 'vitest';
import { entities } from './collection.js';

it('keeps entity identity through reorder, filtering and immutable revisions', () => {
  const a = { id: 'a', title: 'A' },
    b = { id: 'b', title: 'B' };
  const items = [a, b];
  const rows = entities(items);
  expect(entities(items)).toBe(rows);
  expect(rows.map((item) => item.title)).toEqual(['A', 'B']);
  const reversed = entities([b, a]);
  expect(reversed.items.map(reversed.identity)).toEqual(['b', 'a']);
  const revised = entities([{ ...a, title: 'Updated' }, b]);
  expect(revised.filter((item) => item.id === 'a').items.map(revised.identity)).toEqual(['a']);
  expect(rows.items[0]?.title).toBe('A');
  expect(revised.items[0]?.title).toBe('Updated');
});

it('represents unavailable entities with stable empty rows', () => {
  expect(entities(undefined)).toBe(entities(undefined));
  expect(entities(undefined).length).toBe(0);
});
