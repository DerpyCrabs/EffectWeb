import { domBinding, list, observe, view, type JSX } from 'effectweb';
import { Positioner, Arrow } from './positioner.js';
import { popupBinding, type PositionOptions } from './overlay.js';
import { createTypeahead, enabledItems } from './collection.js';
import { createSelection, type SelectionHandle, type SelectionOptions } from './selection.js';
import type { Native } from './types.js';
export type { SelectionValue } from './selection.js';
export type SelectOptions<T = string, M extends boolean = false> = SelectionOptions<T, M>;
export interface SelectHandle<T = string, M extends boolean = false> extends SelectionHandle<T, M> {
  alignment?(): boolean;
  configureAlignment?(enabled: boolean): void;
  pointerType?(type: string): void;
}
/** Create once in the parent controller and own its lifetime. */
/** Create a parent-owned, typed single or multiple selection handle. */
export const createSelect = <T = string, M extends boolean = false>(
  options: SelectOptions<T, M> = {},
) => {
  let align = true;
  let touch = false;
  return {
    ...createSelection(options),
    alignment: () => align && !touch,
    configureAlignment: (enabled: boolean) => {
      align = enabled;
    },
    pointerType: (type: string) => {
      touch = type === 'touch';
    },
  };
};
type Handle = SelectHandle<unknown, boolean>;
export type SelectTriggerProps = Native<'button'> & { readonly select: Handle };
const selectTriggerBinding = (select: Handle) => ({
  ...domBinding(select, (element: HTMLElement) => {
    const typeahead = createTypeahead();
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        select.source.model().open ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const items = select.overlay.popup()
        ? enabledItems(select.overlay.popup()!, '[role=option]')
        : [];
      const index = typeahead(
        items.map((item) => item.textContent ?? ''),
        items.findIndex((item) => item.getAttribute('aria-selected') === 'true'),
        event.key,
        Date.now(),
      );
      if (index !== null) {
        event.preventDefault();
        items[index]?.click();
      }
    };
    element.addEventListener('keydown', key);
    select.overlay.attachTrigger(element);
    return () => {
      element.removeEventListener('keydown', key);
      if (select.overlay.trigger() === element) select.overlay.attachTrigger(undefined);
    };
  }),
  identity: select,
});
/** The button that opens the select and shows the current value; typeahead works while closed. */
export const SelectTrigger = view<SelectTriggerProps>(
  ({ select, children, onClick, onKeyDown, onPointerDown, ...rest }) =>
    observe(select.source, (state) => (
      <button
        {...rest}
        type="button"
        use={selectTriggerBinding(select)}
        disabled={state.disabled || rest.disabled}
        aria-controls={`${select.id}-popup`}
        aria-expanded={state.open}
        aria-haspopup="listbox"
        aria-required={select.required || undefined}
        data-open={state.open ? '' : undefined}
        data-closed={!state.open ? '' : undefined}
        data-placeholder={!select.values().length ? '' : undefined}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (!event.defaultPrevented) select.pointerType?.(event.pointerType);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) select.toggle();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            select.openFromKey(event.key);
          }
        }}
      >
        {children}
      </button>
    )),
);
export type SelectPopupProps = Native<'div'> &
  PositionOptions & { readonly select: Handle; readonly alignItemWithTrigger?: boolean };
const alignmentBinding = (input: { select: Handle; enabled: boolean; configure?: boolean }) =>
  domBinding(input, (element: HTMLElement, current) => {
    if (current().configure) current().select.configureAlignment?.(current().enabled);
    let frame = 0;
    const align = () => {
      const { select, enabled } = current();
      if (!enabled || select.alignment?.() === false || !select.source.model().open) return;
      const popup = select.overlay.popup();
      const trigger = select.overlay.trigger();
      const item = popup?.querySelector<HTMLElement>('[aria-selected=true]');
      if (!popup || !trigger || !item) return;
      const a = trigger.getBoundingClientRect(),
        p = popup.getBoundingClientRect(),
        i = item.getBoundingClientRect();
      const top = a.top + a.height / 2 - (i.top - p.top + i.height / 2);
      if (
        a.top < 20 ||
        a.bottom > window.innerHeight - 20 ||
        top < 0 ||
        top + p.height > window.innerHeight
      )
        return;
      if (popup.style.top !== `${top}px`) popup.style.top = `${top}px`;
      if (popup.dataset.side !== 'none') popup.dataset.side = 'none';
      if (element.dataset.side !== 'none') element.dataset.side = 'none';
      if (popup.dataset.alignTrigger !== 'true') popup.dataset.alignTrigger = 'true';
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(align);
    };
    const stop = current().select.source.subscribe(schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const changes = new MutationObserver(schedule);
    changes.observe(element, {
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-side'],
      childList: true,
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule();
    return {
      update: schedule,
      dispose: () => {
        stop();
        resize.disconnect();
        changes.disconnect();
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', schedule);
        window.removeEventListener('scroll', schedule, true);
      },
    };
  });
/** The listbox popup of a select. */
export const SelectPopup = view<SelectPopupProps>(
  ({
    select,
    children,
    side,
    align,
    sideOffset,
    alignOffset,
    alignItemWithTrigger = true,
    ...rest
  }) => (
    <div use={alignmentBinding({ select, enabled: alignItemWithTrigger })}>
      <div
        {...rest}
        id={`${select.id}-popup`}
        role="listbox"
        aria-multiselectable={select.multiple || undefined}
        popover="manual"
        tabindex={-1}
        use={popupBinding({
          handle: select.overlay,
          kind: 'listbox',
          side,
          align,
          sideOffset,
          alignOffset,
        })}
      >
        {children}
      </div>
    </div>
  ),
);
/** A button that closes the select popup. */
export const SelectClose = view<Native<'button'> & { readonly select: Handle }>(
  ({ select, children, onClick, ...rest }) => (
    <button
      {...rest}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) select.hide();
      }}
    >
      {children}
    </button>
  ),
);
/** A heading for the select popup; its id comes from the handle. */
export const SelectTitle = view<Native<'h2'> & { readonly select: Handle }>(
  ({ select, ...rest }) => <h2 {...rest} id={`${select.id}-title`} />,
);
/** Descriptive text for the select popup; its id comes from the handle. */
export const SelectDescription = view<Native<'p'> & { readonly select: Handle }>(
  ({ select, ...rest }) => <p {...rest} id={`${select.id}-description`} />,
);
export type SelectItemProps = Omit<Native<'button'>, 'value'> & {
  readonly select: Handle;
  readonly value: unknown;
  readonly closeOnClick?: boolean;
};
/** One option identified by `value`; selection and highlight come from the handle. */
export const SelectItem = view<SelectItemProps>(
  ({ select, value, children, onClick, closeOnClick = !select.multiple, ...rest }) =>
    observe(select.source, () => (
      <button
        {...rest}
        type="button"
        role="option"
        tabindex={-1}
        aria-selected={select.selected(value)}
        aria-disabled={rest.disabled || undefined}
        data-selected={select.selected(value) ? '' : undefined}
        data-disabled={rest.disabled ? '' : undefined}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !rest.disabled) {
            select.choose(value);
            if (closeOnClick) select.hide();
          }
        }}
      >
        {children}
      </button>
    )),
);
export type SelectValueProps = Omit<Native<'span'>, 'children'> & {
  readonly select: Handle;
  readonly placeholder?: string | undefined;
  readonly children?: JSX.Element | ((value: unknown) => JSX.Element);
};
/** Displays the selected value or a placeholder, optionally through a custom renderer. */
export const SelectValue = view<SelectValueProps>(({ select, placeholder, children, ...rest }) =>
  observe(select.source, (state) => (
    <span {...rest} data-placeholder={!select.values().length ? '' : undefined}>
      {typeof children === 'function'
        ? children(state.value)
        : (children ??
          (select.values().length
            ? select
                .values()
                .map((value) => select.label(value))
                .join(', ')
            : placeholder))}
    </span>
  )),
);
const formBinding = (select: Handle) =>
  domBinding(select, (element: HTMLInputElement) => {
    const reset = (event: Event) =>
      queueMicrotask(() => {
        if (!event.defaultPrevented) select.reset();
      });
    const form = element.form;
    form?.addEventListener('reset', reset);
    const invalid = (event: Event) => {
      event.preventDefault();
      select.overlay.trigger()?.focus();
    };
    element.addEventListener('invalid', invalid);
    return () => {
      form?.removeEventListener('reset', reset);
      element.removeEventListener('invalid', invalid);
    };
  });
/** A visually hidden validity control plus one successful form entry per selected value. */
export const SelectHiddenInput = view<Native<'input'> & { readonly select: Handle }>(
  ({ select, name, required, form, ...rest }) =>
    observe(select.source, (state) => (
      <>
        <input
          type="text"
          aria-hidden="true"
          tabindex={-1}
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: '0',
            pointerEvents: 'none',
          }}
          use={formBinding(select)}
          form={form ?? select.form}
          required={required ?? select.required}
          disabled={state.disabled}
          value={select.values().length ? 'selected' : ''}
        />
        {list(
          select.values(),
          (value) => select.serialize(value),
          (value) => (
            <input
              {...rest}
              type="hidden"
              form={form ?? select.form}
              name={name ?? select.name}
              value={select.serialize(value)}
              disabled={state.disabled}
            />
          ),
        )}
      </>
    )),
);
/** Groups options under a label; takes the `labelId` of its label. */
export const SelectGroup = view<Native<'div'> & { readonly labelId?: string }>(
  ({ labelId, ...props }) => (
    <div {...props} role="group" aria-labelledby={labelId ?? props['aria-labelledby']} />
  ),
);
/** The label of an option group. */
export const SelectGroupLabel = view<Native<'div'>>((props) => <div {...props} />);
/** The text of an option, used for display and typeahead. */
export const SelectItemText = view<Native<'span'>>((props) => <span {...props} />);
/** The listbox element containing options. */
export const SelectList = view<Native<'div'>>((props) => <div {...props} />);
/** A separator between option groups. */
export const SelectSeparator = view<Native<'div'>>((props) => <div {...props} role="separator" />);
/** An element shown while its option is selected. */
export const SelectItemIndicator = view<
  Native<'span'> & { readonly select: Handle; readonly value: unknown }
>(({ select, value, ...props }) =>
  observe(select.source, () => (
    <span
      {...props}
      aria-hidden="true"
      hidden={!select.selected(value)}
      data-selected={select.selected(value) ? '' : undefined}
    />
  )),
);
const scrollBinding = (input: { select: Handle; direction: number }) =>
  domBinding(input, (element: HTMLElement, current) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const popup = () => current().select.overlay.popup();
    const sync = () => {
      const target = popup();
      const available =
        !!target &&
        (current().direction < 0
          ? target.scrollTop > 0
          : target.scrollTop + target.clientHeight < target.scrollHeight - 1);
      element.style.visibility = available ? 'visible' : 'hidden';
      element.toggleAttribute('data-visible', available);
      if (!available) clearInterval(timer);
    };
    const scroll = () => {
      const target = popup();
      if (target) target.scrollTop += current().direction * 24;
      sync();
    };
    const stop = () => clearInterval(timer);
    const start = () => {
      stop();
      scroll();
      timer = setInterval(scroll, 50);
    };
    const stopSource = current().select.source.subscribe(() => queueMicrotask(sync));
    const resize = new ResizeObserver(sync);
    if (popup()) resize.observe(popup()!);
    window.addEventListener('scroll', sync, true);
    element.addEventListener('pointerenter', start);
    element.addEventListener('pointerleave', stop);
    element.addEventListener('pointercancel', stop);
    queueMicrotask(sync);
    return {
      update: sync,
      dispose: () => {
        stop();
        stopSource();
        resize.disconnect();
        window.removeEventListener('scroll', sync, true);
        element.removeEventListener('pointerenter', start);
        element.removeEventListener('pointerleave', stop);
        element.removeEventListener('pointercancel', stop);
      },
    };
  });
/** An element that scrolls the list up while hovered; visible only when there is content above. */
export const SelectScrollUpArrow = view<Native<'div'> & { readonly select: Handle }>(
  ({ select, ...props }) => (
    <div {...props} aria-hidden="true" use={scrollBinding({ select, direction: -1 })} />
  ),
);
/** An element that scrolls the list down while hovered; visible only when there is content below. */
export const SelectScrollDownArrow = view<Native<'div'> & { readonly select: Handle }>(
  ({ select, ...props }) => (
    <div {...props} aria-hidden="true" use={scrollBinding({ select, direction: 1 })} />
  ),
);
/** Positions the select popup; aligns the selected item over the trigger when `alignItemWithTrigger` is on. */
export const SelectPositioner = view<
  Native<'div'> &
    PositionOptions & { readonly select: Handle; readonly alignItemWithTrigger?: boolean }
>(({ select, alignItemWithTrigger = true, children, ...rest }) => (
  <div use={alignmentBinding({ select, enabled: alignItemWithTrigger, configure: true })}>
    <Positioner {...rest} handle={select.overlay}>
      {children}
    </Positioner>
  </div>
));
/** An arrow element aligned to the select trigger. */
export const SelectArrow = view<Native<'span'> & { readonly select: Handle }>(
  ({ select, ...rest }) => <Arrow {...rest} handle={select.overlay} />,
);
