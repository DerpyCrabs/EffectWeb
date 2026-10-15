import { createPressRepeat } from './press-repeat.js';
import { controlStyle } from './control-style.js';
import { domBinding, modelOwner, observe, view } from 'effectweb';
import type { Native } from './types.js';
import { formatNumber, parseNumber, snapNumber } from './numeric.js';
export interface NumberFieldOptions {
  readonly value?: number | undefined;
  readonly defaultValue?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly largeStep?: number | undefined;
  readonly locale?: string | undefined;
  readonly format?: Intl.NumberFormatOptions | undefined;
  readonly disabled?: boolean | undefined;
  readonly name?: string | undefined;
  readonly form?: string | undefined;
  readonly onValueChange?: ((value: number) => void) | undefined;
}
let numberIds = 0;
/** Create a parent-owned localized number field with stepping and scrub actions. */
export function createNumberField(initial: NumberFieldOptions = {}) {
  let options = initial;
  const normalize = (value: number) =>
    snapNumber(value, options.min ?? -Infinity, options.max ?? Infinity, options.step ?? 1);
  const defaultValue = normalize(initial.defaultValue ?? 0);
  const owner = modelOwner({
    value: normalize(initial.value ?? defaultValue),
    disabled: initial.disabled ?? false,
  });
  const setValue = (raw: number) => {
    if (owner.read().disabled || !Number.isFinite(raw)) return;
    const value = normalize(raw);
    if (value === owner.read().value) return;
    if (options.value === undefined) owner.patch({ value });
    options.onValueChange?.(value);
  };
  const step = (count: number) => setValue(owner.read().value + count * (options.step ?? 1));
  const press = createPressRepeat(step);
  owner.own(press);
  let scrub: { x: number; value: number; pointer: number } | undefined;
  return {
    id: `number-field-${++numberIds}`,
    source: owner.source,
    lifetime: owner,
    press,
    startScrub: (element: HTMLElement, event: PointerEvent) => {
      scrub = { x: event.clientX, value: owner.read().value, pointer: event.pointerId };
      element.setPointerCapture(event.pointerId);
    },
    moveScrub: (event: PointerEvent) => {
      if (scrub && event.pointerId === scrub.pointer)
        setValue(scrub.value + Math.round((event.clientX - scrub.x) / 4) * (options.step ?? 1));
    },
    endScrub: () => {
      scrub = undefined;
    },
    get options() {
      return options;
    },
    setValue,
    step: (count: number) => setValue(owner.read().value + count * (options.step ?? 1)),
    reset: () => setValue(defaultValue),
    format: () => formatNumber(owner.read().value, options.locale, options.format),
    parse: (text: string) => parseNumber(text, options.locale, options.format),
    sync: (next: NumberFieldOptions) => {
      options = next;
      owner.patch({
        value: normalize(next.value ?? owner.read().value),
        disabled: next.disabled ?? false,
      });
    },
  };
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
          value={state.value}
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
/** The text input of a number field; formats with the handle locale, commits on change and blur, steps with arrow and page keys. */
export const NumberFieldInput = view<Native<'input'> & { readonly numberField: NumberFieldHandle }>(
  ({ numberField, onChange, onBlur, onKeyDown, ...rest }) =>
    observe(numberField.source, (state) => (
      <input
        {...rest}
        id={rest.id ?? numberField.id}
        type="text"
        role="spinbutton"
        inputmode="decimal"
        disabled={state.disabled || rest.disabled}
        value={numberField.format()}
        aria-valuenow={state.value}
        aria-valuemin={numberField.options.min}
        aria-valuemax={numberField.options.max}
        aria-valuetext={numberField.format()}
        onChange={(event) => {
          onChange?.(event);
          if (!event.defaultPrevented) {
            const value = numberField.parse(event.currentTarget.value);
            if (value !== null) numberField.setValue(value);
            event.currentTarget.value = numberField.format();
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.defaultPrevented) event.currentTarget.value = numberField.format();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || state.disabled) return;
          const options = numberField.options;
          const amount =
            event.shiftKey || event.key.startsWith('Page')
              ? (options.largeStep ?? (options.step ?? 1) * 10)
              : (options.step ?? 1);
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
                  : state.value + direction! * amount,
            );
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
            ? state.value >= (numberField.options.max ?? Infinity)
            : state.value <= (numberField.options.min ?? -Infinity))
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
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          if (event.defaultPrevented) return;
          numberField.press.stop(event.currentTarget);
        }}
        onLostPointerCapture={(event) => {
          onLostPointerCapture?.(event);
          if (event.defaultPrevented) return;
          numberField.press.stop(event.currentTarget);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          const repeated = numberField.press.consume(event.currentTarget);
          if (!event.defaultPrevented && !repeated) numberField.step(direction);
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
    }}
  />
));
