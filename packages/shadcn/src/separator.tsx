import { Separator as BaseSeparator } from '@effectweb/base-ui';
import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native } from './types.js';

/** A horizontal or vertical divider. Set decorative to false for separator semantics. */
export const Separator = view<
  Native<'div'> & {
    readonly class?: string | undefined;
    readonly orientation?: 'horizontal' | 'vertical' | undefined;
    readonly decorative?: boolean | undefined;
  }
>(({ class: className, orientation, decorative, ...rest }) => (
  <BaseSeparator
    data-slot="separator"
    decorative={decorative !== false}
    orientation={orientation}
    role={decorative === false ? 'separator' : 'none'}
    data-orientation={orientation ?? 'horizontal'}
    aria-orientation={decorative === false ? (orientation ?? 'horizontal') : undefined}
    class={cn(
      'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
      className,
    )}
    {...rest}
  />
));
