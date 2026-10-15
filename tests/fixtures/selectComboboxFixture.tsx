import { mount, modelOwner, observe, view } from 'effectweb';
import {
  createSelect,
  SelectTrigger,
  SelectPopup,
  SelectItem,
  SelectValue,
} from '../../packages/base-ui/src/select';
import { list, mapSource } from 'effectweb';
import { SelectHiddenInput, SelectItemIndicator } from '../../packages/base-ui/src/select';
import {
  createCombobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxStatus,
  ComboboxClear,
  ComboboxHiddenInput,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxCreate,
} from '../../packages/base-ui/src/combobox';
import { createAutocomplete, AutocompleteInput } from '../../packages/base-ui/src/autocomplete';
export function mountSelectComboboxFixture(host: HTMLElement) {
  const owner = modelOwner({ items: ['Apple', 'Apricot', 'Banana', 'Cherry'] });
  const select = createSelect<{ id: string; label: string }, true>({
    multiple: true,
    defaultValue: [{ id: 'a', label: 'Alpha' }],
    itemToStringLabel: (item) => item.label,
    itemToStringValue: (item) => item.id,
    isItemEqualToValue: (a, b) => a.id === b.id,
    name: 'letters',
    required: true,
  });
  const combo = createCombobox({
    items: mapSource(owner.source, (state) => state.items),
    isItemDisabled: (item) => item === 'Apricot',
    name: 'fruit',
  });
  const multi = createCombobox({
    items: ['Red', 'Green', 'Blue'],
    multiple: true,
    createItem: (query) => query,
  });
  const auto = createAutocomplete({ items: ['Apple', 'Apricot', 'Banana'], mode: 'inline' });
  for (const handle of [select, combo, multi, auto]) owner.own(handle.lifetime);
  const Page = view(() => (
    <section aria-label="Select and editable collections" style={{ paddingTop: '180px' }}>
      <form aria-label="Collection form">
        <SelectTrigger select={select} aria-label="Letters">
          <SelectValue select={select} placeholder="Pick letters" />
        </SelectTrigger>
        <SelectPopup select={select} aria-label="Letters list">
          <SelectItem select={select} value={{ id: 'a', label: 'Alpha' }}>
            Alpha
            <SelectItemIndicator select={select} value={{ id: 'a', label: 'Alpha' }}>
              ✓
            </SelectItemIndicator>
          </SelectItem>
          <SelectItem select={select} value={{ id: 'b', label: 'Beta' }}>
            Beta
          </SelectItem>
        </SelectPopup>
        <SelectHiddenInput select={select} />
        <ComboboxInput combobox={combo} aria-label="Search fruit" />
        <ComboboxPopup combobox={combo}>
          <ComboboxList combobox={combo} aria-label="Fruit suggestions">
            <ComboboxCollection combobox={combo} />
          </ComboboxList>
          <ComboboxEmpty combobox={combo}>No fruit</ComboboxEmpty>
        </ComboboxPopup>
        <ComboboxStatus combobox={combo} />
        <ComboboxClear combobox={combo}>Clear fruit</ComboboxClear>
        <ComboboxHiddenInput combobox={combo} />
        <button type="reset">Reset collections</button>
      </form>
      <button
        onClick={() => {
          combo.setLoading(true);
          owner.patch({ items: [] });
        }}
      >
        Load fruit
      </button>
      <button
        onClick={() => {
          owner.patch({ items: ['Date', 'Dragonfruit'] });
          combo.setLoading(false);
        }}
      >
        Resolve fruit
      </button>
      <ComboboxInput combobox={multi} aria-label="Colors" />
      <ComboboxPopup combobox={multi}>
        <ComboboxList combobox={multi} aria-label="Color suggestions">
          <ComboboxCollection combobox={multi} />
        </ComboboxList>
        <ComboboxCreate combobox={multi} />
      </ComboboxPopup>
      {observe(multi.source, () =>
        list(
          multi.values(),
          (value) => value,
          (value) => (
            <ComboboxChip combobox={multi} value={value}>
              {value}
              <ComboboxChipRemove combobox={multi} value={value}>
                ×
              </ComboboxChipRemove>
            </ComboboxChip>
          ),
        ),
      )}
      <AutocompleteInput autocomplete={auto} aria-label="Inline fruit" />
      <ComboboxPopup combobox={auto}>
        <ComboboxList combobox={auto}>
          <ComboboxCollection combobox={auto} />
        </ComboboxList>
      </ComboboxPopup>
    </section>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
