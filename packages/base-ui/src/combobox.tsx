import { OverlayPortal, type OverlayPortalProps } from './overlay-portal.js';
import type { PopupFocusOptions } from './popup-focus.js';
import { composeMounts } from 'effectweb';
import {
  domBinding,
  list,
  mapSource,
  modelOwner,
  observe,
  view,
  type Source,
  type JSX,
} from 'effectweb';
import { createSelection, type SelectionOptions, type SelectionHandle } from './selection.js';
import { popupBinding, type PositionOptions } from './overlay.js';
import { Positioner } from './positioner.js';
import { nextIndex } from './collection.js';
import {
  SelectHiddenInput,
  SelectValue,
  SelectGroup,
  SelectGroupLabel,
  SelectSeparator,
} from './select.js';
import type { Native } from './types.js';
export type FilterMode = 'contains' | 'startsWith';
/** Create accent-insensitive and case-insensitive contains and startsWith matchers. */
export function createFilter(locale?: string) {
  const normalize = (text: string) =>
    text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale);
  return {
    contains: (value: string, query: string) => normalize(value).includes(normalize(query)),
    startsWith: (value: string, query: string) => normalize(value).startsWith(normalize(query)),
  };
}
export interface ComboboxOptions<T, M extends boolean = false> extends SelectionOptions<T, M> {
  readonly items?: readonly T[] | Source<readonly T[]>;
  readonly filter?: FilterMode | ((item: T, query: string) => boolean) | null;
  readonly inputValue?: string;
  readonly defaultInputValue?: string;
  readonly onInputValueChange?: (value: string) => void;
  readonly loading?: boolean;
  readonly isItemDisabled?: (item: T) => boolean;
  readonly createItem?: (query: string) => T;
  readonly autoHighlight?: boolean;
  readonly mode?: 'list' | 'inline' | 'both' | 'none';
  readonly onActiveChange?: (index: number) => void;
}
export interface ComboboxState<T> {
  readonly items: readonly T[];
  readonly filteredItems: readonly T[];
  readonly inputValue: string;
  readonly activeIndex: number;
  readonly loading: boolean;
  readonly open: boolean;
  readonly disabled: boolean;
}
export interface ComboboxHandle<T = string, M extends boolean = false> extends SelectionHandle<
  T,
  M
> {
  readonly inputSource: Source<ComboboxState<T>>;
  readonly mode: 'list' | 'inline' | 'both' | 'none';
  input(value: string): void;
  setItems(items: readonly T[]): void;
  syncInputValue(value: string): void;
  setLoading(loading: boolean): void;
  highlight(index: number): void;
  commit(item: T, event?: Event): void;
  clear(): void;
  key(event: KeyboardEvent): void;
  itemId(item: T): string;
  disabledItem(item: T): boolean;
  create(): void;
  canCreate(): boolean;
}
type ItemRegistration = { value: unknown; id: string | undefined; disabled: boolean | undefined };
const itemIdentities = new WeakMap<object, (value: unknown) => string>();
const itemRegistries = new WeakMap<object, (item: ItemRegistration) => () => void>();
const acquireItemRegistration = (
  _element: HTMLElement,
  current: () => ItemRegistration & { combobox: object },
) => {
  let previous = current();
  let stop = itemRegistries.get(previous.combobox)?.(previous);
  return {
    update() {
      const next = current();
      if (
        next.combobox === previous.combobox &&
        next.value === previous.value &&
        next.id === previous.id &&
        next.disabled === previous.disabled
      )
        return;
      stop?.();
      previous = next;
      stop = itemRegistries.get(next.combobox)?.(next);
    },
    dispose() {
      stop?.();
    },
  };
};
/** Create an editable collection with filtering, keyboard navigation and typed selection. */
export function createCombobox<T = string, M extends boolean = false>(
  options: ComboboxOptions<T, M> = {},
): ComboboxHandle<T, M> {
  let itemCloseCanceled = false;
  const selection = createSelection({
    ...options,
    onOpenChange(open, details) {
      options.onOpenChange?.(open, details);
      if (!open && details.reason === 'item-press') itemCloseCanceled = details.isCanceled;
    },
  });
  const itemsSource =
    options.items && !Array.isArray(options.items) && 'model' in options.items
      ? options.items
      : undefined;
  const items = itemsSource?.model() ?? (options.items as readonly T[] | undefined) ?? [];
  const mode = options.mode ?? 'list';
  const inputValue =
    options.inputValue ??
    options.defaultInputValue ??
    (!options.multiple && selection.values().length ? selection.label(selection.values()[0]!) : '');
  const filters = createFilter();
  const filter = (items: readonly T[], query: string) =>
    options.filter === null || mode === 'none' || mode === 'inline'
      ? items
      : items.filter((item) =>
          typeof options.filter === 'function'
            ? options.filter(item, query)
            : filters[options.filter ?? 'contains'](selection.label(item), query),
        );
  const owner = modelOwner<{ state: ComboboxState<T> }>({
    state: {
      items,
      filteredItems: filter(items, inputValue),
      inputValue,
      activeIndex: -1,
      loading: options.loading ?? false,
      open: selection.source.model().open,
      disabled: selection.source.model().disabled,
    },
  });
  owner.own(selection.lifetime);
  const read = () => owner.read().state;
  const patch = (state: Partial<ComboboxState<T>>) =>
    owner.patch({ state: { ...read(), ...state } });
  const registeredItems: ItemRegistration[] = [];
  const sameItem = options.isItemEqualToValue ?? Object.is;
  const disabledItem = (item: T) =>
    !!options.isItemDisabled?.(item) ||
    registeredItems.some((entry) => sameItem(entry.value as T, item) && entry.disabled === true);
  const highlight = (index: number) => {
    const item = read().filteredItems[index];
    const activeIndex = item !== undefined && !disabledItem(item) ? index : -1;
    patch({ activeIndex });
    options.onActiveChange?.(activeIndex);
  };
  const refilter = (items: readonly T[], inputValue: string) => {
    const filteredItems = filter(items, inputValue);
    patch({
      items,
      inputValue,
      filteredItems,
      activeIndex:
        options.autoHighlight || mode === 'inline' || mode === 'both'
          ? filteredItems.findIndex(
              (item) =>
                !disabledItem(item) &&
                (mode !== 'inline' || filters.startsWith(selection.label(item), inputValue)),
            )
          : -1,
    });
  };
  const input = (value: string) => {
    if (read().disabled) return;
    if (options.inputValue === undefined) refilter(read().items, value);
    options.onInputValueChange?.(value);
    selection.setOpen(true);
  };
  const commit = (item: T, event?: Event) => {
    if (disabledItem(item) || read().disabled) return;
    selection.choose(item);
    if (!selection.multiple) {
      itemCloseCanceled = false;
      selection.overlay.hide({ reason: 'item-press', event: event ?? new Event('change') });
      if (itemCloseCanceled) return;
    }
    const value = selection.multiple ? '' : selection.label(item);
    if (options.inputValue === undefined) refilter(read().items, value);
    options.onInputValueChange?.(value);
  };
  const ids: T[] = [];
  const equal = options.isItemEqualToValue ?? Object.is;
  const defaultItemId = (item: T) => {
    let index = ids.findIndex((value) => equal(value, item));
    if (index < 0) {
      index = ids.length;
      ids.push(item);
    }
    return `${selection.id}-option-${index}`;
  };
  const itemId = (item: T) =>
    registeredItems.find((entry) => entry.id !== undefined && equal(entry.value as T, item))?.id ??
    defaultItemId(item);
  const canCreate = () =>
    !!options.createItem &&
    !!read().inputValue.trim() &&
    !read().items.some(
      (item) => selection.label(item).toLocaleLowerCase() === read().inputValue.toLocaleLowerCase(),
    );
  const create = () => {
    if (canCreate()) {
      const item = options.createItem!(read().inputValue);
      refilter([...read().items, item], read().inputValue);
      commit(item);
    }
  };
  owner.own(
    selection.source.subscribe(({ open, disabled }) =>
      patch({ open, disabled, ...(!open ? { activeIndex: -1 } : {}) }),
    ),
  );
  if (itemsSource) owner.own(itemsSource.subscribe((items) => refilter(items, read().inputValue)));
  const clear = () => {
    if (read().disabled) return;
    selection.setValue(
      (selection.multiple ? [] : null) as Parameters<typeof selection.setValue>[0],
    );
    if (options.inputValue === undefined) refilter(read().items, '');
    options.onInputValueChange?.('');
    selection.overlay.trigger()?.focus();
  };
  const handle: ComboboxHandle<T, M> = {
    ...selection,
    lifetime: owner,
    inputSource: mapSource(owner.source, (model) => model.state),
    mode,
    input,
    highlight,
    commit,
    clear,
    itemId,
    disabledItem,
    canCreate,
    create,
    syncInputValue: (value) => refilter(read().items, value),
    setItems: (items) => refilter(items, read().inputValue),
    setLoading: (loading) => patch({ loading }),
    reset: () => {
      selection.reset();
      refilter(
        read().items,
        options.defaultInputValue ??
          (!selection.multiple && selection.values().length
            ? selection.label(selection.values()[0]!)
            : ''),
      );
      selection.hide();
    },
    key: (event) => {
      if (event.defaultPrevented || event.isComposing || read().disabled) return;
      const state = read();
      if (
        event.key === 'ArrowLeft' &&
        selection.multiple &&
        !state.inputValue &&
        selection.values().length
      ) {
        event.preventDefault();
        selection.overlay
          .trigger()
          ?.ownerDocument.getElementById(`${itemId(selection.values().at(-1)!)}-chip`)
          ?.focus();
        return;
      }
      if (event.key === 'Escape' && state.open) {
        event.preventDefault();
        selection.hide();
        return;
      }
      if (event.key === 'Tab') {
        selection.hide();
        return;
      }
      if (event.key === 'Enter' && state.open) {
        const item = state.filteredItems[state.activeIndex];
        if (item !== undefined) {
          event.preventDefault();
          commit(item, event);
        } else if (canCreate()) {
          event.preventDefault();
          create();
        }
        return;
      }
      if (
        event.key === 'Backspace' &&
        !state.inputValue &&
        selection.multiple &&
        selection.values().length
      ) {
        selection.remove(selection.values().at(-1)!);
        return;
      }
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        (state.open && ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
      ) {
        event.preventDefault();
        selection.setOpen(true);
        const enabled = state.filteredItems
          .map((item, index) => (disabledItem(item) ? -1 : index))
          .filter((index) => index >= 0);
        const next = nextIndex(
          enabled.length,
          enabled.indexOf(state.activeIndex),
          event.key,
          'vertical',
          false,
        );
        highlight(next === null ? -1 : (enabled[next] ?? -1));
      }
    },
  };
  itemIdentities.set(handle, (value) => defaultItemId(value as T));
  itemRegistries.set(handle, (entry) => {
    registeredItems.push(entry);
    patch({});
    return () => {
      const index = registeredItems.indexOf(entry);
      if (index >= 0) registeredItems.splice(index, 1);
      if (!owner.disposed) patch({});
    };
  });
  owner.own(() => {
    itemIdentities.delete(handle);
    itemRegistries.delete(handle);
    registeredItems.length = 0;
  });
  return handle;
}
type Handle = ComboboxHandle<unknown, boolean>;
export type ComboboxInputProps = Native<'input'> & { readonly combobox: Handle };
const inputBinding = (combobox: Handle) => ({
  ...domBinding(combobox, (element: HTMLInputElement) => {
    combobox.overlay.attachTrigger(element);
    let composing = false;
    const start = () => {
      composing = true;
    };
    const end = () => {
      composing = false;
      combobox.input(element.value);
    };
    const sync = () => {
      if (composing) return;
      const state = combobox.inputSource.model();
      const item = state.filteredItems[state.activeIndex];
      const label = item === undefined ? '' : combobox.label(item);
      const inline =
        (combobox.mode === 'inline' || combobox.mode === 'both') &&
        state.open &&
        !!state.inputValue &&
        item !== undefined;
      const value = inline ? label : state.inputValue;
      if (element.value !== value) element.value = value;
      if (inline && element.ownerDocument.activeElement === element)
        element.setSelectionRange(
          label.toLocaleLowerCase().startsWith(state.inputValue.toLocaleLowerCase())
            ? state.inputValue.length
            : 0,
          label.length,
        );
      if (item !== undefined)
        element.ownerDocument
          .getElementById(combobox.itemId(item))
          ?.scrollIntoView({ block: 'nearest' });
    };
    const stop = combobox.inputSource.subscribe(sync);
    element.addEventListener('compositionstart', start);
    element.addEventListener('compositionend', end);
    sync();
    return {
      update: sync,
      dispose: () => {
        stop();
        element.removeEventListener('compositionstart', start);
        element.removeEventListener('compositionend', end);
        if (combobox.overlay.trigger() === element) combobox.overlay.attachTrigger(undefined);
      },
    };
  }),
  identity: combobox,
});
/** The editable input of a combobox; filters items and keeps focus while `aria-activedescendant` tracks the highlight. */
export const ComboboxInput = view<ComboboxInputProps>(
  ({ combobox, onInput, onKeyDown, onBlur, ...props }) =>
    observe(combobox.inputSource, (state) => (
      <input
        {...props}
        use={composeMounts([props.use, inputBinding(combobox)])}
        role="combobox"
        autocomplete="off"
        disabled={state.disabled || props.disabled}
        aria-autocomplete={combobox.mode}
        aria-controls={`${combobox.id}-list`}
        aria-expanded={state.open}
        aria-haspopup="listbox"
        aria-activedescendant={
          state.open &&
          state.activeIndex >= 0 &&
          state.filteredItems[state.activeIndex] !== undefined
            ? combobox.itemId(state.filteredItems[state.activeIndex])
            : undefined
        }
        aria-busy={state.loading || undefined}
        onInput={(event) => {
          onInput?.(event);
          if (!event.defaultPrevented && !event.isComposing)
            combobox.input(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          combobox.key(event);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (event.defaultPrevented) return;
          if (
            !event.defaultPrevented &&
            !combobox.overlay.popup()?.contains(event.relatedTarget as Node)
          )
            combobox.hide();
        }}
      />
    )),
);
/** A button that opens or closes the combobox popup. */
export const ComboboxTrigger = view<Native<'button'> & { readonly combobox: Handle }>(
  ({ combobox, onClick, onPointerDown, ...props }) =>
    observe(combobox.inputSource, (state) => (
      <button
        {...props}
        type="button"
        data-overlay-parent={combobox.id}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (!event.defaultPrevented) event.preventDefault();
        }}
        tabindex={-1}
        disabled={state.disabled || props.disabled}
        aria-label={props['aria-label'] ?? 'Open suggestions'}
        aria-expanded={state.open}
        aria-controls={`${combobox.id}-list`}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            combobox.toggle();
            combobox.overlay.trigger()?.focus();
          }
        }}
      />
    )),
);
export type ComboboxPopupProps = Native<'div'> &
  PositionOptions &
  PopupFocusOptions & { readonly combobox: Handle };
/** The popup listing combobox items. */
export const ComboboxPopup = view<ComboboxPopupProps>(
  ({
    combobox,
    side,
    align,
    sideOffset,
    alignOffset,
    collisionAvoidance,
    anchor,
    initialFocus,
    finalFocus,
    ...props
  }) =>
    observe(combobox.inputSource, (state) => (
      <div
        {...props}
        popover="manual"
        data-empty={!state.filteredItems.length ? '' : undefined}
        data-loading={state.loading ? '' : undefined}
        use={composeMounts([
          props.use,
          popupBinding({
            handle: combobox.overlay,
            initialFocus,
            finalFocus,
            kind: 'popover',
            side,
            align,
            sideOffset,
            alignOffset,
            collisionAvoidance,
            anchor,
          }),
        ])}
      />
    )),
);
/** Positions the combobox popup against its input. */
export const ComboboxPositioner = view<ComboboxPopupProps>(({ combobox, ...props }) => (
  <Positioner {...props} handle={combobox.overlay} />
));
/** The listbox element containing combobox items. */
export const ComboboxList = view<Native<'div'> & { readonly combobox: Handle }>(
  ({ combobox, ...props }) =>
    observe(combobox.inputSource, (state) => (
      <div
        {...props}
        id={`${combobox.id}-list`}
        role="listbox"
        aria-multiselectable={combobox.multiple || undefined}
        aria-busy={state.loading || undefined}
        data-empty={!state.filteredItems.length ? '' : undefined}
      />
    )),
);
export type ComboboxItemProps = Native<'div'> & {
  readonly disabled?: boolean;
  readonly combobox: Handle;
  readonly value: unknown;
  readonly index?: number;
};
/** One combobox option identified by `value`; selection and highlight come from the handle. */
export const ComboboxItem = view<ComboboxItemProps>(
  ({
    combobox,
    value,
    index,
    disabled: itemDisabled,
    onClick,
    onPointerMove,
    onPointerDown,
    ...props
  }) =>
    observe(combobox.inputSource, (state) =>
      observe(combobox.source, () => {
        const position =
          index ??
          state.filteredItems.findIndex((item) => combobox.itemId(item) === combobox.itemId(value));
        const disabled = itemDisabled || combobox.disabledItem(value);
        return (
          <div
            {...props}
            id={props.id ?? combobox.itemId(value)}
            use={composeMounts([
              props.use,
              domBinding(
                { combobox, value, id: props.id, disabled: itemDisabled },
                acquireItemRegistration,
              ),
            ])}
            role="option"
            tabindex={-1}
            aria-selected={combobox.selected(value)}
            aria-disabled={disabled || undefined}
            aria-posinset={position + 1}
            aria-setsize={state.filteredItems.length}
            data-highlighted={position === state.activeIndex ? '' : undefined}
            data-selected={combobox.selected(value) ? '' : undefined}
            data-disabled={disabled ? '' : undefined}
            onPointerDown={(event) => {
              onPointerDown?.(event);
              if (event.defaultPrevented) return;
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              onPointerMove?.(event);
              if (!event.defaultPrevented && !disabled) combobox.highlight(position);
            }}
            onClick={(event) => {
              onClick?.(event);
              if (!event.defaultPrevented && !disabled) combobox.commit(value, event);
            }}
          />
        );
      }),
    ),
);
/** Stable IDs and logical indices permit windowing via start/end and onActiveChange. */
export const ComboboxCollection = view<{
  readonly combobox: Handle;
  readonly renderItem?: (item: unknown, index: number) => JSX.Element;
  readonly start?: number;
  readonly end?: number;
}>(({ combobox, renderItem, start = 0, end }) =>
  observe(combobox.inputSource, (state) =>
    list(
      state.filteredItems.slice(start, end),
      (item) => itemIdentities.get(combobox)?.(item) ?? combobox.itemId(item),
      (item, index) =>
        renderItem ? (
          renderItem(item, start + index)
        ) : (
          <ComboboxItem combobox={combobox} value={item} index={start + index}>
            {combobox.label(item)}
          </ComboboxItem>
        ),
    ),
  ),
);
/** A button that clears the combobox value and query. */
export const ComboboxClear = view<Native<'button'> & { readonly combobox: Handle }>(
  ({ combobox, onClick, ...props }) => (
    <button
      {...props}
      type="button"
      aria-label={props['aria-label'] ?? 'Clear selection'}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) combobox.clear();
      }}
    />
  ),
);
/** Content shown when no item matches the query. */
export const ComboboxEmpty = view<Native<'div'> & { readonly combobox: Handle }>(
  ({ combobox, ...props }) =>
    observe(combobox.inputSource, (state) => (
      <div {...props} hidden={state.loading || state.filteredItems.length > 0} />
    )),
);
/** A live region announcing loading state and result counts. */
export const ComboboxStatus = view<Native<'div'> & { readonly combobox: Handle }>(
  ({ combobox, children, ...props }) =>
    observe(combobox.inputSource, (state) => (
      <div {...props} role="status" aria-live="polite" aria-atomic="true">
        {children ??
          (state.loading
            ? 'Loading suggestions'
            : `${state.filteredItems.length} suggestions available`)}
      </div>
    )),
);
/** An option that creates a new item from the current query through the handle `createItem`. */
export const ComboboxCreate = view<Native<'button'> & { readonly combobox: Handle }>(
  ({ combobox, onClick, onPointerDown, children, ...props }) =>
    observe(combobox.inputSource, () => (
      <button
        {...props}
        type="button"
        hidden={!combobox.canCreate()}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
        }}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) combobox.create();
        }}
      >
        {children ?? `Create “${combobox.inputSource.model().inputValue}”`}
      </button>
    )),
);
/** The container of selected-value chips in a multiple combobox; ArrowLeft from the input enters it. */
export const ComboboxChips = view<Native<'div'>>((props) => <div {...props} />);
/** One selected value in a multiple combobox; focusable, removable with Delete or Backspace. */
export const ComboboxChip = view<
  Native<'span'> & { readonly combobox: Handle; readonly value: unknown }
>(({ combobox, value, onKeyDown, ...props }) => (
  <span
    {...props}
    id={`${combobox.itemId(value)}-chip`}
    tabindex={0}
    data-disabled={combobox.source.model().disabled ? '' : undefined}
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (!event.defaultPrevented && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        combobox.remove(value);
        combobox.overlay.trigger()?.focus();
      }
    }}
  />
));
/** A button inside a chip that removes its value. */
export const ComboboxChipRemove = view<
  Omit<Native<'button'>, 'value'> & { readonly combobox: Handle; readonly value: unknown }
>(({ combobox, value, onClick, ...props }) => (
  <button
    {...props}
    type="button"
    aria-label={props['aria-label'] ?? `Remove ${combobox.label(value)}`}
    onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        combobox.remove(value);
        combobox.overlay.trigger()?.focus();
      }
    }}
  />
));
/** Displays the selected value or a placeholder. */
export const ComboboxValue = view<
  Omit<Native<'span'>, 'children'> & {
    readonly combobox: Handle;
    readonly placeholder?: string;
    readonly children?: JSX.Element | ((value: unknown) => JSX.Element);
  }
>(({ combobox, ...props }) => <SelectValue {...props} select={combobox} />);
/** Hidden form inputs that submit the selected values under `name`. */
export const ComboboxHiddenInput = view<Native<'input'> & { readonly combobox: Handle }>(
  ({ combobox, ...props }) => <SelectHiddenInput {...props} select={combobox} />,
);
/** An element shown while its item is selected. */
export const ComboboxItemIndicator = view<
  Native<'span'> & { readonly combobox: Handle; readonly value: unknown }
>(({ combobox, value, ...props }) =>
  observe(combobox.source, () => (
    <span {...props} aria-hidden="true" hidden={!combobox.selected(value)} />
  )),
);
/** Groups combobox items under a label. */
export const ComboboxGroup = SelectGroup;
/** The label of a combobox group. */
export const ComboboxGroupLabel = SelectGroupLabel;
/** A separator between combobox groups. */
export const ComboboxSeparator = SelectSeparator;

export type ComboboxPortalProps = Omit<OverlayPortalProps, 'handle'> & {
  readonly combobox: Handle;
};
/** Mount popup content while open or exiting; keepMounted explicitly retains closed content. */
export const ComboboxPortal = view<ComboboxPortalProps>(({ combobox, ...props }) => (
  <OverlayPortal handle={combobox.overlay} {...props} />
));
