import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** The shared classes for native labels. */
export const labelClass =
  'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50';

/** A native label; associate it with a control using for or nesting. */
export const Label = view<Native<'label'> & Styled>(({ class: className, children, ...rest }) => (
  <label data-slot="label" class={cn(labelClass, className)} {...rest}>
    {children}
  </label>
));
