import { controllerView, list, mapSource, modelOwner, observe, view } from 'effectweb';
import {
  createSlider,
  SliderRoot,
  SliderControl,
  SliderTrack,
  SliderIndicator,
  SliderThumb,
  type SliderOptions,
} from '@effectweb/base-ui/slider';
import { cn } from './cn.js';
import type { Native } from './types.js';
export type SliderProps = Omit<Native<'input'>, 'type' | 'value' | 'min' | 'max' | 'step' | 'dir'> &
  SliderOptions & { readonly class?: string | undefined };
export {
  createSlider,
  SliderRoot,
  SliderControl,
  SliderTrack,
  SliderIndicator,
  SliderThumb,
  type SliderHandle,
} from '@effectweb/base-ui/slider';
function sliderAdapter(props: SliderProps) {
  let current = props;
  const owner = modelOwner({ revision: 0 });
  const options = (next: SliderProps): SliderOptions => ({
    ...next,
    onValueChange: (value) => current.onValueChange?.(value),
    onValuesChange: (values) => current.onValuesChange?.(values),
  });
  const slider = createSlider(options(props));
  owner.own(slider.lifetime);
  return {
    source: mapSource(owner.source, () => ({ props: current })),
    lifetime: owner,
    slider,
    receive: (next: SliderProps) => {
      current = next;
      slider.sync(options(next));
      owner.edit('revision', (n) => n + 1);
    },
  };
}
const SliderParts = view<{
  readonly props: SliderProps;
  readonly slider: ReturnType<typeof createSlider>;
}>(({ props, slider }) => {
  const {
    class: className,
    value: _value,
    values: _values,
    defaultValue: _defaultValue,
    defaultValues: _defaultValues,
    onValueChange: _onValueChange,
    onValuesChange: _onValuesChange,
    min: _min,
    max: _max,
    step: _step,
    largeStep: _largeStep,
    orientation: _orientation,
    dir: _dir,
    name: _name,
    form: _form,
    ...rest
  } = props;
  return (
    <SliderRoot
      slider={slider}
      class={cn('data-horizontal:w-full data-vertical:h-full', className)}
      data-slot="slider"
    >
      <SliderControl
        slider={slider}
        class="relative flex min-h-4 w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col"
      >
        <SliderTrack
          slider={slider}
          data-slot="slider-track"
          class="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderIndicator
            slider={slider}
            data-slot="slider-range"
            class="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderTrack>
        {observe(slider.source, (state) =>
          list(
            state.values.map((_, i) => i),
            (index) => (
              <SliderThumb
                {...rest}
                slider={slider}
                index={index}
                aria-label={
                  rest['aria-label']
                    ? state.values.length > 1
                      ? `${rest['aria-label']} ${index + 1}`
                      : rest['aria-label']
                    : undefined
                }
                data-slot="slider-thumb"
                class="relative block size-3 shrink-0 appearance-none rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50 [&::-webkit-slider-thumb]:appearance-none [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent"
              />
            ),
          ),
        )}
      </SliderControl>
    </SliderRoot>
  );
});
/** Controlled numeric values and explicit ranges. */
export const Slider = controllerView(
  { controller: sliderAdapter },
  view((model) => <SliderParts props={model.props} slider={model.actions.slider} />),
);
