import { direction } from './direction.js';
import { controlStyle } from './control-style.js';
import { domBinding, modelOwner, observe, view, list } from 'effectweb';
import type { Native } from './types.js';
import { snapNumber } from './numeric.js';
export interface SliderOptions {
  readonly value?: number | undefined;
  readonly values?: readonly number[] | undefined;
  readonly defaultValue?: number | undefined;
  readonly defaultValues?: readonly number[] | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly largeStep?: number | undefined;
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
  readonly dir?: 'ltr' | 'rtl' | undefined;
  readonly disabled?: boolean | undefined;
  readonly name?: string | undefined;
  readonly form?: string | undefined;
  readonly onValueChange?: ((value: number) => void) | undefined;
  readonly onValuesChange?: ((values: readonly number[]) => void) | undefined;
}
let sliderIds = 0;
/** Create a parent-owned single or range slider with controlled synchronization. */
export function createSlider(initial: SliderOptions = {}) {
  let options = initial;
  const normalize = (values: readonly number[]) =>
    (values.length ? values : [options.min ?? 0])
      .map((value) => snapNumber(value, options.min ?? 0, options.max ?? 100, options.step ?? 1))
      .sort((a, b) => a - b);
  const defaults = normalize(initial.defaultValues ?? [initial.defaultValue ?? initial.min ?? 0]);
  const owner = modelOwner({
    values: normalize(initial.values ?? (initial.value === undefined ? defaults : [initial.value])),
    disabled: initial.disabled ?? false,
  });
  let control: HTMLElement | undefined;
  let drag: { index: number; pointer: number } | undefined;
  const setValues = (values: readonly number[]) => {
    if (owner.read().disabled) return;
    const next = normalize(values);
    if (
      next.length === owner.read().values.length &&
      next.every((value, index) => value === owner.read().values[index])
    )
      return;
    if (options.value === undefined && options.values === undefined) owner.patch({ values: next });
    options.onValuesChange?.(next);
    options.onValueChange?.(next[0]!);
  };
  const set = (index: number, value: number) => {
    const values = [...owner.read().values];
    values[index] = Math.max(
      values[index - 1] ?? options.min ?? 0,
      Math.min(
        values[index + 1] ?? options.max ?? 100,
        snapNumber(value, options.min ?? 0, options.max ?? 100, options.step ?? 1),
      ),
    );
    setValues(values);
  };
  return {
    id: `slider-${++sliderIds}`,
    source: owner.source,
    lifetime: owner,
    get options() {
      return options;
    },
    get control() {
      return control;
    },
    attach: (element: HTMLElement | undefined) => {
      control = element;
      if (!element) drag = undefined;
    },
    startDrag: (event: PointerEvent, index: number) => {
      drag = { index, pointer: event.pointerId };
      control?.setPointerCapture(event.pointerId);
      control?.querySelector<HTMLElement>(`[data-slider-index="${index}"]`)?.focus();
    },
    get drag() {
      return drag;
    },
    endDrag: () => {
      drag = undefined;
    },
    set,
    setValues,
    reset: () => setValues(defaults),
    sync: (next: SliderOptions) => {
      options = next;
      owner.patch({
        disabled: next.disabled ?? false,
        values: normalize(
          next.values ?? (next.value === undefined ? owner.read().values : [next.value]),
        ),
      });
    },
    percent: (value: number) =>
      ((value - (options.min ?? 0)) / ((options.max ?? 100) - (options.min ?? 0) || 1)) * 100,
    pointer: (event: PointerEvent, index?: number) => {
      if (!control || owner.read().disabled) return;
      const rect = control.getBoundingClientRect();
      const vertical = options.orientation === 'vertical';
      let ratio = vertical
        ? 1 - (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width;
      if (!vertical && (options.dir ?? direction(control)) === 'rtl') ratio = 1 - ratio;
      const value = (options.min ?? 0) + ratio * ((options.max ?? 100) - (options.min ?? 0));
      const target =
        index ??
        owner
          .read()
          .values.reduce(
            (best, v, i, values) =>
              Math.abs(v - value) < Math.abs(values[best]! - value) ? i : best,
            0,
          );
      set(target, value);
      return target;
    },
  };
}
export type SliderHandle = ReturnType<typeof createSlider>;
export type SliderPartProps = Native<'div'> & { readonly slider: SliderHandle };
const acquireControl = (element: HTMLElement, current: () => SliderHandle) => {
  current().attach(element);
  const sync = () =>
    element.style.setProperty(
      '--slider-thumb-translate',
      direction(element) === 'rtl' ? '50%' : '-50%',
    );
  sync();
  return { update: sync, dispose: () => current().attach(undefined) };
};
const acquireForm = (element: HTMLInputElement, current: () => SliderHandle) => {
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
/** The slider container; publishes orientation, disabled state and hidden form inputs. */
export const SliderRoot = view<SliderPartProps>(({ slider, children, ...rest }) =>
  observe(slider.source, (state) => (
    <div
      {...rest}
      dir={slider.options.dir ?? rest.dir}
      data-orientation={slider.options.orientation ?? 'horizontal'}
      data-horizontal={slider.options.orientation !== 'vertical' ? '' : undefined}
      data-vertical={slider.options.orientation === 'vertical' ? '' : undefined}
      data-disabled={state.disabled ? '' : undefined}
    >
      {children}
      {list(
        state.values.map((_, i) => i),
        (index) => (
          <input
            type="hidden"
            name={slider.options.name}
            form={slider.options.form}
            disabled={state.disabled}
            value={state.values[index]}
            use={index === 0 ? domBinding(slider, acquireForm) : undefined}
          />
        ),
      )}
    </div>
  )),
);
/** The interactive area of a slider; pointer input maps to values. */
export const SliderControl = view<SliderPartProps>(
  ({ slider, style, onPointerDown, onPointerMove, onLostPointerCapture, ...rest }) =>
    observe(slider.source, (state) => (
      <div
        {...rest}
        data-disabled={state.disabled ? '' : undefined}
        data-orientation={slider.options.orientation ?? 'horizontal'}
        data-horizontal={slider.options.orientation !== 'vertical' ? '' : undefined}
        data-vertical={slider.options.orientation === 'vertical' ? '' : undefined}
        style={controlStyle({ position: 'relative', touchAction: 'none' }, style)}
        use={domBinding(slider, acquireControl)}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (event.defaultPrevented || event.button !== 0 || state.disabled) return;
          const thumb = (event.target as Element).closest<HTMLElement>('[data-slider-index]');
          const index = slider.pointer(
            event,
            thumb ? Number(thumb.dataset.sliderIndex) : undefined,
          );
          if (index !== undefined) slider.startDrag(event, index);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (!event.defaultPrevented && slider.drag?.pointer === event.pointerId)
            slider.pointer(event, slider.drag.index);
        }}
        onLostPointerCapture={(event) => {
          onLostPointerCapture?.(event);
          if (event.defaultPrevented) return;
          slider.endDrag();
        }}
      />
    )),
);
/** The track of a slider. */
export const SliderTrack = view<SliderPartProps>(({ slider, ...rest }) => (
  <div
    {...rest}
    data-orientation={slider.options.orientation ?? 'horizontal'}
    data-horizontal={slider.options.orientation !== 'vertical' ? '' : undefined}
    data-vertical={slider.options.orientation === 'vertical' ? '' : undefined}
  />
));
/** The filled range of a slider between its values. */
export const SliderIndicator = view<SliderPartProps>(({ slider, style, ...rest }) =>
  observe(slider.source, (state) => {
    const start = state.values.length > 1 ? slider.percent(state.values[0]!) : 0;
    const end = slider.percent(state.values[state.values.length - 1]!);
    const vertical = slider.options.orientation === 'vertical';
    return (
      <div
        {...rest}
        data-orientation={slider.options.orientation ?? 'horizontal'}
        data-horizontal={!vertical ? '' : undefined}
        data-vertical={vertical ? '' : undefined}
        style={controlStyle(
          {
            position: 'absolute',
            ...(vertical
              ? { bottom: `${start}%`, height: `${end - start}%` }
              : { insetInlineStart: `${start}%`, width: `${end - start}%` }),
          },
          style,
        )}
      />
    );
  }),
);
/** The draggable thumb for one value index; arrow, page, Home and End keys step it. */
export const SliderThumb = view<
  Native<'input'> & { readonly slider: SliderHandle; readonly index?: number | undefined }
>(({ slider, index = 0, onKeyDown, style, ...rest }) =>
  observe(slider.source, (state) => {
    const options = slider.options;
    const vertical = options.orientation === 'vertical';
    const value = state.values[index] ?? options.min ?? 0;
    return (
      <input
        {...rest}
        type="range"
        value={value}
        min={state.values[index - 1] ?? options.min ?? 0}
        max={state.values[index + 1] ?? options.max ?? 100}
        step={options.step ?? 1}
        disabled={state.disabled || rest.disabled}
        role="slider"
        tabindex={state.disabled ? -1 : 0}
        data-slider-index={index}
        aria-disabled={state.disabled}
        aria-valuenow={value}
        aria-valuemin={state.values[index - 1] ?? options.min ?? 0}
        aria-valuemax={state.values[index + 1] ?? options.max ?? 100}
        aria-orientation={options.orientation ?? 'horizontal'}
        data-disabled={state.disabled ? '' : undefined}
        style={controlStyle(
          {
            position: 'absolute',
            ...(vertical
              ? { bottom: `${slider.percent(value)}%`, transform: 'translateY(50%)' }
              : {
                  insetInlineStart: `${slider.percent(value)}%`,
                  transform: 'translateX(var(--slider-thumb-translate, -50%))',
                }),
          },
          style,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || state.disabled) return;
          const step =
            event.shiftKey || event.key.startsWith('Page')
              ? (options.largeStep ?? (options.step ?? 1) * 10)
              : (options.step ?? 1);
          const right = (options.dir ?? direction(event.currentTarget)) === 'rtl' ? -1 : 1;
          const delta = (
            {
              ArrowRight: right,
              ArrowLeft: -right,
              ArrowUp: 1,
              ArrowDown: -1,
              PageUp: 1,
              PageDown: -1,
            } as Record<string, number>
          )[event.key];
          if (delta !== undefined || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            slider.set(
              index,
              event.key === 'Home'
                ? (options.min ?? 0)
                : event.key === 'End'
                  ? (options.max ?? 100)
                  : value + delta! * step,
            );
          }
        }}
      />
    );
  }),
);
