import './shadcn.css';
import { mount, modelOwner, view } from 'effectweb';
import { Select } from '../../packages/shadcn/src/select';
import {
  createCombobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '../../packages/shadcn/src/combobox';
export function mountStyledCollections(host: HTMLElement) {
  const owner = modelOwner({});
  const combobox = createCombobox({ items: ['Apple', 'Pear'] });
  owner.own(combobox.lifetime);
  const Page = view(() => (
    <>
      <Select
        options={[
          { value: 'apple', label: 'Apple' },
          { value: 'pear', label: 'Pear' },
        ]}
        aria-label="Styled fruit"
        placeholder="Pick fruit"
      />
      <ComboboxInput combobox={combobox} aria-label="Styled search" showClear />
      <ComboboxContent combobox={combobox}>
        <ComboboxList combobox={combobox}>
          <ComboboxItem combobox={combobox} value="Apple">
            Apple
          </ComboboxItem>
          <ComboboxItem combobox={combobox} value="Pear">
            Pear
          </ComboboxItem>
        </ComboboxList>
        <ComboboxEmpty combobox={combobox}>No matches</ComboboxEmpty>
      </ComboboxContent>
    </>
  ));
  const mounted = mount(host, Page, owner.source);
  return {
    dispose: () => {
      mounted.dispose();
      owner.dispose();
    },
  };
}
