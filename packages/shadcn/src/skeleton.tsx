import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A pulsing placeholder. Supply dimensions through class or style. */
export const Skeleton = view<Native<'div'> & Styled>(({ class: className, children, ...rest }) => (
  <div data-slot="skeleton" class={cn('animate-pulse rounded-md bg-muted', className)} {...rest}>
    {children}
  </div>
));
