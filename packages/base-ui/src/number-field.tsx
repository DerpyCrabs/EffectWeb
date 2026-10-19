import { createPressRepeat } from './press-repeat.js';
import { controlStyle } from './control-style.js';
import { domBinding, modelOwner, observe, view } from 'effectweb';
import type { Native } from './types.js';
import { formatNumber, parseNumber, snapNumber } from './numeric.js';
type CommitReason = 'input-blur' | 'keyboard' | 'increment-press' | 'decrement-press' | 'scrub';
type CommitDetails = { readonly event: Event; readonly reason: CommitReason };
const editors = new WeakMap<
  object,
  { input(text: string, composing?: boolean): void; finish(text: string): void }
>();
const commits = new WeakMap<object, (event: Event, reason: CommitReason) => void>();
const commitNumberField = (field: object, event: Event, reason: CommitReason) =>
  commits.get(field)?.(event, reason);
export interface NumberFieldOptions {
  readonly value?: number | null | undefined;
  readonly defaultValue?: number | null | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | 'any' | undefined;
  readonly largeStep?: number | undefined;
  readonly locale?: string | undefined;
  readonly format?: Intl.NumberFormatOptions | undefined;
  readonly disabled?: boolean | undefined;
  readonly name?: string | undefined;
  readonly form?: string | undefined;
  readonly onValueChange?: ((value: number | null) => void) | undefined;
  readonly onValueCommitted?: ((value: number | null, details: CommitDetails) => void) | undefined;
}
let numberIds = 0;
/** Create a parent-owned localized number field with stepping and scrub actions. */
export function createNumberField(initial: NumberFieldOptions = {}) {
  let options = initial;
  const increment = () => (typeof options.step === 'number' ? options.step : 1);
  const normalize = (value: number | null) =>
    value === null
      ? null
      : options.step === 'any'
        ? Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, value))
        : snapNumber(value, options.min ?? -Infinity, options.max ?? Infinity, increment());
  const defaultValue = normalize(initial.defaultValue ?? null);
  const formatted = (value: number | null) =>
    value === null ? '' : formatNumber(value, options.locale, options.format);
  const initialValue = normalize(initial.value === undefined ? defaultValue : initial.value);
  let editing = false;
  const owner = modelOwner({
    value: initialValue,
    inputValue: formatted(initialValue),
    disabled: initial.disabled ?? false,
  });
  let pendingCommit: { value: number | null } | undefined;
  const requestValue = (value: number | null) => {
    if (owner.disposed || owner.read().disabled || (value !== null && !Number.isFinite(value)))
      return;
    if (value === owner.read().value) return;
    if (options.value !== undefined && pendingCommit?.value === value) return;
    pendingCommit = { value };
    if (options.value === undefined) owner.patch({ value });
    options.onValueChange?.(value);
  };
  const setValue = (raw: number | null) => {
    if (owner.disposed || owner.read().disabled) return;
    editing = false;
    requestValue(normalize(raw));
    owner.patch({ inputValue: formatted(owner.read().value) });
  };
  const input = (text: string, composing = false) => {
    if (owner.disposed || owner.read().disabled) return;
    editing = true;
    owner.patch({ inputValue: text });
    if (composing) return;
    const value = parseNumber(text, options.locale, options.format);
    if (value !== null || text.trim() === '') {
      if (value === owner.read().value && pendingCommit?.value !== value) pendingCommit = undefined;
      requestValue(value);
    }
  };
  const finish = (text: string) => {
    if (owner.disposed || owner.read().disabled) return;
    editing = false;
    const value = parseNumber(text, options.locale, options.format);
    if (value !== null)
      requestValue(Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, value)));
    else if (text.trim() === '') requestValue(null);
    owner.patch({ inputValue: formatted(owner.read().value) });
  };
  const step = (count: number) => setValue((owner.read().value ?? 0) + count * increment());
  const press = createPressRepeat(step);
  owner.own(press);
  let scrub: { x: number; value: number; pointer: number } | undefined;
  const handle = {
    id: `number-field-${++numberIds}`,
    source: owner.source,
    lifetime: owner,
    press,
    startScrub: (element: HTMLElement, event: PointerEvent) => {
      scrub = { x: event.clientX, value: owner.read().value ?? 0, pointer: event.pointerId };
      element.setPointerCapture(event.pointerId);
    },
    moveScrub: (event: PointerEvent) => {
      if (scrub && event.pointerId === scrub.pointer)
        setValue(scrub.value + Math.round((event.clientX - scrub.x) / 4) * increment());
    },
    endScrub: () => {
      scrub = undefined;
    },
    get options() {
      return options;
    },
    setValue,
    step: (count: number) => setValue((owner.read().value ?? 0) + count * increment()),
    reset: () => {
      setValue(defaultValue);
      pendingCommit = undefined;
    },
    format: () => {
      const value = owner.read().value;
      return value === null ? '' : formatNumber(value, options.locale, options.format);
    },
    parse: (text: string) => parseNumber(text, options.locale, options.format),
    sync: (next: NumberFieldOptions) => {
      const previous = owner.read();
      const formatChanged = next.locale !== options.locale || next.format !== options.format;
      const value = next.value === undefined ? previous.value : next.value;
      const acceptsEdit =
        value === previous.value ||
        value === parseNumber(previous.inputValue, options.locale, options.format);
      options = next;
      if (!acceptsEdit) pendingCommit = undefined;
      if (formatChanged || !acceptsEdit || next.disabled) editing = false;
      owner.patch({
        value,
        inputValue: editing ? previous.inputValue : formatted(value),
        disabled: next.disabled ?? false,
      });
    },
  };
  editors.set(handle, { input, finish });
  commits.set(handle, (event, reason) => {
    const pending = pendingCommit;
    pendingCommit = undefined;
    if (pending && !owner.read().disabled)
      options.onValueCommitted?.(pending.value, { event, reason });
  });
  owner.own(() => {
    commits.delete(handle);
    editors.delete(handle);
    pendingCommit = undefined;
  });
  return handle;
}
export type NumberFieldHandle = ReturnType<typeof createNumberField>;
/** The number field container; publishes disabled and invalid attributes. */
export const NumberFieldRoot = view<Native<'div'> & { readonly numberField: NumberFieldHandle }>(
  ({ numberField, children, ...rest }) =>
    observe(numberField.source, (state) => (
      <div {...rest} data-disabled={state.disabled ? '' : undefined}>
        {children}
        <input
          type="hidden"
          value={state.value ?? ''}
          name={numberField.options.name}
          form={numberField.options.form}
          disabled={state.disabled}
          use={domBinding(numberField, acquireNumberForm)}
        />
      </div>
    )),
);
const acquireNumberForm = (element: HTMLInputElement, current: () => NumberFieldHandle) => {
  const form = element.form;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const reset = (event: Event) => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (!event.defaultPrevented) current().reset();
    }, 0);
  };
  form?.addEventListener('reset', reset);
  return {
    dispose: () => {
      clearTimeout(pending);
      form?.removeEventListener('reset', reset);
    },
  };
};
/** The text input of a number field; preserves localized edits, commits on blur, and steps with arrow and page keys. */
export const NumberFieldInput = view<Native<'input'> & { readonly numberField: NumberFieldHandle }>(
  ({ numberField, onInput, onChange, onBlur, onKeyDown, onCompositionEnd, ...rest }) =>
    observe(numberField.source, (state) => (
      <input
        {...rest}
        id={rest.id ?? numberField.id}
        type="text"
        role="spinbutton"
        inputmode="decimal"
        disabled={state.disabled || rest.disabled}
        value={state.inputValue}
        aria-valuenow={state.value ?? undefined}
        aria-valuemin={numberField.options.min}
        aria-valuemax={numberField.options.max}
        aria-valuetext={numberField.format()}
        onInput={(event) => {
          onInput?.(event);
          if (!event.defaultPrevented)
            editors.get(numberField)?.input(event.currentTarget.value, event.isComposing);
        }}
        onCompositionEnd={(event) => {
          onCompositionEnd?.(event);
          if (!event.defaultPrevented) editors.get(numberField)?.input(event.currentTarget.value);
        }}
        onChange={(event) => {
          onChange?.(event);
          if (!event.defaultPrevented) editors.get(numberField)?.input(event.currentTarget.value);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.defaultPrevented) {
            editors.get(numberField)?.finish(event.currentTarget.value);
            commitNumberField(numberField, event, 'input-blur');
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.isComposing || state.disabled) return;
          const options = numberField.options;
          const step = typeof options.step === 'number' ? options.step : 1;
          const amount =
            event.shiftKey || event.key.startsWith('Page')
              ? (options.largeStep ?? step * 10)
              : step;
          const direction = (
            { ArrowUp: 1, ArrowDown: -1, PageUp: 1, PageDown: -1 } as Record<string, number>
          )[event.key];
          if (
            direction !== undefined ||
            (event.key === 'Home' && options.min !== undefined) ||
            (event.key === 'End' && options.max !== undefined)
          ) {
            event.preventDefault();
            numberField.setValue(
              event.key === 'Home'
                ? options.min!
                : event.key === 'End'
                  ? options.max!
                  : (state.value ?? 0) + direction! * amount,
            );
            commitNumberField(numberField, event, 'keyboard');
          }
        }}
      />
    )),
);
type StepProps = Native<'button'> & { readonly numberField: NumberFieldHandle };
const acquireHold = (element: HTMLButtonElement, current: () => NumberFieldHandle) => ({
  dispose: () => current().press.stop(element),
});
const StepButton = view<StepProps & { readonly direction: number }>(
  ({
    numberField,
    direction,
    onClick,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    ...rest
  }) =>
    observe(numberField.source, (state) => (
      <button
        {...rest}
        type="button"
        disabled={
          state.disabled ||
          rest.disabled ||
          (direction > 0
            ? state.value !== null && state.value >= (numberField.options.max ?? Infinity)
            : state.value !== null && state.value <= (numberField.options.min ?? -Infinity))
        }
        aria-controls={numberField.id}
        use={domBinding(numberField, acquireHold)}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (!event.defaultPrevented && event.button === 0 && !event.currentTarget.disabled)
            numberField.press.start(event.currentTarget, event, direction);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          if (event.defaultPrevented) return;
          numberField.press.stop(event.currentTarget);
          commitNumberField(
            numberField,
            event,
            direction > 0 ? 'increment-press' : 'decrement-press',
          );
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          if (event.defaultPrevented) return;
          numberField.press.stop(event.currentTarget);
          commitNumberField(
            numberField,
            event,
            direction > 0 ? 'increment-press' : 'decrement-press',
          );
        }}
        onLostPointerCapture={(event) => {
          onLostPointerCapture?.(event);
          if (event.defaultPrevented) return;
          numberField.press.stop(event.currentTarget);
          commitNumberField(
            numberField,
            event,
            direction > 0 ? 'increment-press' : 'decrement-press',
          );
        }}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          const repeated = numberField.press.consume(event.currentTarget);
          if (!event.defaultPrevented && !repeated) {
            numberField.step(direction);
            commitNumberField(
              numberField,
              event,
              direction > 0 ? 'increment-press' : 'decrement-press',
            );
          }
        }}
      />
    )),
);
/** A button that steps the value up; repeats while held. */
export const NumberFieldIncrement = view<StepProps>((props) => (
  <StepButton aria-label="Increase" {...props} direction={1} />
));
/** A button that steps the value down; repeats while held. */
export const NumberFieldDecrement = view<StepProps>((props) => (
  <StepButton aria-label="Decrease" {...props} direction={-1} />
));
const acquireScrub = (_element: HTMLElement, current: () => NumberFieldHandle) => ({
  dispose: () => current().endScrub(),
});
/** An element that changes the value by dragging horizontally. */
export const NumberFieldScrubArea = view<
  Native<'span'> & { readonly numberField: NumberFieldHandle }
>(({ numberField, style, onPointerDown, onPointerMove, onLostPointerCapture, ...rest }) => (
  <span
    {...rest}
    style={controlStyle({ touchAction: 'none', cursor: 'ew-resize' }, style)}
    use={domBinding(numberField, acquireScrub)}
    onPointerDown={(event) => {
      onPointerDown?.(event);
      if (event.defaultPrevented || event.button !== 0 || numberField.source.model().disabled)
        return;
      numberField.startScrub(event.currentTarget, event);
      event.preventDefault();
    }}
    onPointerMove={(event) => {
      onPointerMove?.(event);
      if (!event.defaultPrevented) numberField.moveScrub(event);
    }}
    onLostPointerCapture={(event) => {
      onLostPointerCapture?.(event);
      if (event.defaultPrevented) return;
      numberField.endScrub();
      commitNumberField(numberField, event, 'scrub');
    }}
  />
));
