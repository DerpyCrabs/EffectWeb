import { view } from 'effectweb';
import type { Native } from './types.js';
/** A separator with `horizontal` or `vertical` orientation; decorative or semantic. */
export const Separator = view<
  Native<'div'> & {
    readonly orientation?: 'horizontal' | 'vertical' | undefined;
    readonly decorative?: boolean | undefined;
  }
>(({ orientation = 'horizontal', decorative = false, ...rest }) => (
  <div
    {...rest}
    role={decorative ? 'none' : 'separator'}
    aria-orientation={decorative ? undefined : orientation}
    data-orientation={orientation}
  />
));
