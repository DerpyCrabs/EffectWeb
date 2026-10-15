import { view, type JSX } from 'effectweb';
import {
  createCombobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxStatus,
  ComboboxClear,
  ComboboxPositioner,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxSeparator,
  type ComboboxOptions,
  type ComboboxHandle,
  type ComboboxInputProps,
  type ComboboxPopupProps,
  type ComboboxItemProps,
} from './combobox.js';
import type { Native } from './types.js';
/** Autocomplete keeps editable text as its result; committing a suggestion publishes that text. */
/** Create input suggestions using list, inline, both or none completion mode. */
export const createAutocomplete = <T = string,>(options: ComboboxOptions<T, false> = {}) =>
  createCombobox<T, false>(options);
export type AutocompleteHandle<T = string> = ComboboxHandle<T, false>;
type Handle = ComboboxHandle<unknown, boolean>;
/** The text input of an autocomplete; typing filters or completes according to the handle `mode`. */
export const AutocompleteInput = view<
  Omit<ComboboxInputProps, 'combobox' | 'autocomplete'> & { readonly autocomplete: Handle }
>(({ autocomplete, ...props }) => <ComboboxInput {...props} combobox={autocomplete} />);
/** The popup listing autocomplete suggestions. */
export const AutocompletePopup = view<
  Omit<ComboboxPopupProps, 'combobox'> & { readonly autocomplete: Handle }
>(({ autocomplete, ...props }) => <ComboboxPopup {...props} combobox={autocomplete} />);
/** Positions the autocomplete popup under its input. */
export const AutocompletePositioner = view<
  Omit<ComboboxPopupProps, 'combobox'> & { readonly autocomplete: Handle }
>(({ autocomplete, ...props }) => <ComboboxPositioner {...props} combobox={autocomplete} />);
/** One suggestion; highlighted through `aria-activedescendant` while the input keeps focus. */
export const AutocompleteItem = view<
  Omit<ComboboxItemProps, 'combobox'> & { readonly autocomplete: Handle }
>(({ autocomplete, ...props }) => <ComboboxItem {...props} combobox={autocomplete} />);
/** The listbox element containing autocomplete items. */
export const AutocompleteList = view<Native<'div'> & { readonly autocomplete: Handle }>(
  ({ autocomplete, ...props }) => <ComboboxList {...props} combobox={autocomplete} />,
);
/** Content shown when no suggestion matches the input. */
export const AutocompleteEmpty = view<Native<'div'> & { readonly autocomplete: Handle }>(
  ({ autocomplete, ...props }) => <ComboboxEmpty {...props} combobox={autocomplete} />,
);
/** A live region announcing loading state and result counts. */
export const AutocompleteStatus = view<Native<'div'> & { readonly autocomplete: Handle }>(
  ({ autocomplete, ...props }) => <ComboboxStatus {...props} combobox={autocomplete} />,
);
/** A button that clears the autocomplete input. */
export const AutocompleteClear = view<Native<'button'> & { readonly autocomplete: Handle }>(
  ({ autocomplete, ...props }) => <ComboboxClear {...props} combobox={autocomplete} />,
);
/** Renders the suggestions as keyed rows; accepts `renderItem`, `start` and `end` for a virtualized window. */
export const AutocompleteCollection = view<{
  readonly autocomplete: Handle;
  readonly renderItem?: (item: unknown, index: number) => JSX.Element;
  readonly start?: number;
  readonly end?: number;
}>(({ autocomplete, ...props }) => <ComboboxCollection {...props} combobox={autocomplete} />);
/** Groups suggestions under a label. */
export const AutocompleteGroup = ComboboxGroup;
/** The label of a suggestion group. */
export const AutocompleteGroupLabel = ComboboxGroupLabel;
/** A separator between suggestion groups. */
export const AutocompleteSeparator = ComboboxSeparator;
