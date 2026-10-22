import { view } from 'effectweb';
import type { Native } from './types.js';
/** A `meter` element: a measurement within a known range, with the clamped value and its thresholds. */
export const MeterRoot = view<
  Native<'div'> & {
    readonly value: number;
    readonly min?: number | undefined;
    readonly max?: number | undefined;
    readonly low?: number | undefined;
    readonly high?: number | undefined;
    readonly optimum?: number | undefined;
  }
>(({ value, min = 0, max = 100, low, high, optimum, ...rest }) => {
  const clamped = Math.max(min, Math.min(max, value));
  const region =
    low !== undefined && clamped < low
      ? 'low'
      : high !== undefined && clamped > high
        ? 'high'
        : 'medium';
  return (
    <div
      {...rest}
      role="meter"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamped}
      data-region={region}
      data-optimum={optimum === undefined ? undefined : clamped === optimum ? '' : undefined}
      data-complete={clamped >= max ? '' : undefined}
    />
  );
});
/** The track of a meter. */
export const MeterTrack = view<Native<'div'>>((props) => <div {...props} />);
/** The filled part of a meter, sized from the value. */
export const MeterIndicator = view<Native<'div'>>((props) => <div {...props} />);
/** The label of a meter. */
export const MeterLabel = view<Native<'span'>>((props) => <span {...props} />);
/** The formatted value of a meter. */
export const MeterValue = view<Native<'span'>>((props) => <span {...props} />);
