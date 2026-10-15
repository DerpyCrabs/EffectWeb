import { view } from 'effectweb';
import type { Native } from './types.js';
/** A `progressbar` element with the clamped value and indeterminate or complete state attributes. */
export const ProgressRoot = view<
  Native<'div'> & { readonly value: number | null; readonly max?: number | undefined }
>(({ value, max = 100, ...rest }) => (
  <div
    {...rest}
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuenow={value === null ? undefined : Math.max(0, Math.min(max, value))}
    data-indeterminate={value === null ? '' : undefined}
    data-complete={value !== null && value >= max ? '' : undefined}
  />
));
/** The track of a progress bar. */
export const ProgressTrack = view<Native<'div'>>((props) => <div {...props} />);
/** The filled part of a progress bar, sized from the value. */
export const ProgressIndicator = view<Native<'div'>>((props) => <div {...props} />);
/** The label of a progress bar. */
export const ProgressLabel = view<Native<'span'>>((props) => <span {...props} />);
/** The formatted value of a progress bar. */
export const ProgressValue = view<Native<'span'>>((props) => <span {...props} />);
