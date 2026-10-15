import { modelOwner, mapSource, type Source, type ControllerLifetime } from 'effectweb';
import { createOverlay, type OverlayHandle, type OverlayOptions } from './overlay.js';
export type SelectionValue<T, M extends boolean> = M extends true ? readonly T[] : T | null;
export interface SelectionState<T, M extends boolean> {
  readonly value: SelectionValue<T, M>;
  readonly open: boolean;
  readonly disabled: boolean;
}
export interface SelectionOptions<T, M extends boolean = false> extends Pick<
  OverlayOptions,
  'id' | 'open' | 'defaultOpen' | 'disabled' | 'onOpenChange' | 'restoreFocus'
> {
  readonly multiple?: M;
  readonly value?: SelectionValue<T, M>;
  readonly defaultValue?: SelectionValue<T, M>;
  readonly onValueChange?: (value: SelectionValue<T, M>) => void;
  readonly isItemEqualToValue?: (a: T, b: T) => boolean;
  readonly itemToStringLabel?: (value: T) => string;
  readonly itemToStringValue?: (value: T) => string;
  readonly name?: string;
  readonly required?: boolean;
  readonly form?: string;
}
export interface SelectionHandle<T = string, M extends boolean = false> {
  readonly id: string;
  readonly overlay: OverlayHandle;
  readonly source: Source<SelectionState<T, M>>;
  readonly lifetime: ControllerLifetime;
  readonly multiple: boolean;
  readonly name: string | undefined;
  readonly required: boolean;
  readonly form: string | undefined;
  setValue(value: SelectionValue<T, M>): void;
  choose(value: T): void;
  remove(value: T): void;
  selected(value: T): boolean;
  label(value: T): string;
  serialize(value: T): string;
  values(): readonly T[];
  reset(): void;
  sync(state: Partial<SelectionState<T, M>>): void;
  toggle(): void;
  hide(): void;
  setOpen(open: boolean): void;
  openFromKey(key: string): void;
}
/** Toggle a value using the supplied equality predicate without mutating the previous array. */
export function toggleSelection<T>(
  values: readonly T[],
  value: T,
  equal: (a: T, b: T) => boolean = Object.is,
): readonly T[] {
  return values.some((item) => equal(item, value))
    ? values.filter((item) => !equal(item, value))
    : [...values, value];
}
/** The shared selection state used by Select, Combobox and Autocomplete: values, highlight, typeahead and item equality. */
export function createSelection<T = string, M extends boolean = false>(
  options: SelectionOptions<T, M> = {},
): SelectionHandle<T, M> {
  const initial = (options.defaultValue ?? (options.multiple ? [] : null)) as SelectionValue<T, M>;
  const overlay = createOverlay({
    id: options.id,
    ...(options.open !== undefined ? { open: options.open } : {}),
    defaultOpen: options.defaultOpen,
    disabled: options.disabled ?? false,
    onOpenChange: options.onOpenChange,
    restoreFocus: options.restoreFocus,
  });
  const owner = modelOwner<{ state: SelectionState<T, M> }>({
    state: {
      value: options.value !== undefined ? options.value : initial,
      open: overlay.source.model().open,
      disabled: options.disabled ?? false,
    },
  });
  const read = () => owner.read().state;
  const patch = (next: Partial<SelectionState<T, M>>) =>
    owner.patch({ state: { ...read(), ...next } });
  owner.own(overlay.lifetime);
  owner.own(overlay.source.subscribe(({ open, disabled }) => patch({ open, disabled })));
  const equal = options.isItemEqualToValue ?? Object.is;
  const values = (): readonly T[] => {
    const value = read().value;
    return options.multiple ? (value as readonly T[]) : value === null ? [] : [value as T];
  };
  const setValue = (value: SelectionValue<T, M>) => {
    if (read().disabled) return;
    if (options.value === undefined) patch({ value });
    options.onValueChange?.(value);
  };
  return {
    id: overlay.id,
    overlay,
    source: mapSource(owner.source, (model) => model.state),
    lifetime: owner,
    multiple: options.multiple ?? false,
    name: options.name,
    required: options.required ?? false,
    form: options.form,
    setValue,
    values,
    selected: (value) => values().some((item) => equal(item, value)),
    label: options.itemToStringLabel ?? ((value) => String(value ?? '')),
    serialize: options.itemToStringValue ?? ((value) => String(value ?? '')),
    choose: (value) =>
      setValue(
        (options.multiple ? toggleSelection(values(), value, equal) : value) as SelectionValue<
          T,
          M
        >,
      ),
    remove: (value) =>
      setValue(
        (options.multiple
          ? values().filter((item) => !equal(item, value))
          : null) as SelectionValue<T, M>,
      ),
    reset: () => setValue(initial),
    sync: (state) => {
      patch(state);
      overlay.sync({
        ...(state.open !== undefined ? { open: state.open } : {}),
        ...(state.disabled !== undefined ? { disabled: state.disabled } : {}),
      });
    },
    toggle: overlay.toggle,
    hide: overlay.hide,
    setOpen: overlay.setOpen,
    openFromKey: overlay.openFromKey,
  };
}
