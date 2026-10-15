import { describe, expect, it } from 'vitest';
import { createSelect } from './select.js';
import { createCombobox, createFilter } from './combobox.js';
import { createAutocomplete } from './autocomplete.js';
import { toggleSelection } from './selection.js';
import { nextIndex, createTypeahead } from './collection.js';
import { modelOwner, mapSource } from 'effectweb';
describe('typed collections', () => {
  it('toggles object values by equality without mutating earlier snapshots', () => {
    const select = createSelect<{ id: number }, true>({
      multiple: true,
      defaultValue: [{ id: 1 }],
      isItemEqualToValue: (a, b) => a.id === b.id,
    });
    const previous = select.source.model();
    select.choose({ id: 2 });
    expect(select.values()).toEqual([{ id: 1 }, { id: 2 }]);
    select.choose({ id: 1 });
    expect(select.values()).toEqual([{ id: 2 }]);
    expect(previous.value).toEqual([{ id: 1 }]);
    select.reset();
    expect(select.values()).toEqual([{ id: 1 }]);
    select.lifetime.dispose();
  });
  it('controlled selection requests await sync and disabled requests are ignored', () => {
    const values: (number | null)[] = [];
    const select = createSelect({ value: 1, onValueChange: (value) => values.push(value) });
    select.choose(2);
    expect(values).toEqual([2]);
    expect(select.values()).toEqual([1]);
    select.sync({ value: 2, disabled: true });
    select.choose(3);
    expect(values).toEqual([2]);
    select.lifetime.dispose();
  });
  it('filters accents, casing, prefixes, custom predicates and unfiltered mode', () => {
    expect(createFilter().contains('Café', 'FE')).toBe(true);
    expect(createFilter().startsWith('Banana', 'ana')).toBe(false);
    const combo = createCombobox({
      items: ['Apple', 'Pear'],
      filter: (item, query) => item.length === query.length,
    });
    combo.input('four');
    expect(combo.inputSource.model().filteredItems).toEqual(['Pear']);
    combo.lifetime.dispose();
    const all = createAutocomplete({ items: ['Apple'], mode: 'none' });
    all.input('z');
    expect(all.inputSource.model().filteredItems).toEqual(['Apple']);
    all.lifetime.dispose();
  });
  it('observes async sources, preserves selection, exposes loading and creates values', () => {
    const owner = modelOwner({ items: ['Apple'] });
    const combo = createCombobox({
      items: mapSource(owner.source, (state) => state.items),
      createItem: (value) => value,
      multiple: true,
    });
    combo.setLoading(true);
    expect(combo.inputSource.model().loading).toBe(true);
    owner.patch({ items: ['Pear'] });
    expect(combo.inputSource.model().items).toEqual(['Pear']);
    combo.input('Plum');
    expect(combo.canCreate()).toBe(true);
    combo.create();
    expect(combo.values()).toEqual(['Plum']);
    combo.clear();
    expect(combo.values()).toEqual([]);
    combo.lifetime.dispose();
    owner.dispose();
  });
  it('supports paging, empty typeahead and repeated letters', () => {
    expect(nextIndex(20, 10, 'PageDown')).toBe(19);
    expect(nextIndex(20, 10, 'PageUp')).toBe(0);
    expect(createTypeahead()([], -1, 'a', 0)).toBeNull();
    const find = createTypeahead();
    expect(find(['Apple', 'Apricot'], 0, 'a', 0)).toBe(1);
    expect(find(['Apple', 'Apricot'], 1, 'a', 10)).toBe(0);
    expect(toggleSelection([1, 2], 1)).toEqual([2]);
  });
});

it('autocomplete inline and none keep the list static; both and list filter', () => {
  for (const mode of ['inline', 'none', 'both', 'list'] as const) {
    const handle = createAutocomplete({ items: ['Apple', 'Banana'], mode });
    handle.input('Ap');
    expect(handle.inputSource.model().filteredItems).toEqual(
      mode === 'inline' || mode === 'none' ? ['Apple', 'Banana'] : ['Apple'],
    );
    handle.lifetime.dispose();
  }
});
it('controlled input requests wait for explicit synchronization, including null selection', () => {
  const changes: string[] = [];
  const handle = createCombobox({
    items: ['Apple'],
    inputValue: '',
    value: null,
    defaultValue: 'Apple',
    onInputValueChange: (value) => changes.push(value),
  });
  expect(handle.values()).toEqual([]);
  handle.input('Ap');
  expect(changes).toEqual(['Ap']);
  expect(handle.inputSource.model().inputValue).toBe('');
  handle.syncInputValue('Ap');
  expect(handle.inputSource.model().inputValue).toBe('Ap');
  handle.lifetime.dispose();
});
