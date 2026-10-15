import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A keyboard key or shortcut rendered as kbd. */
export const Kbd = view<Native<'kbd'> & Styled>(({ class: className, children, ...rest }) => (
  <kbd
    data-slot="kbd"
    class={cn(
      "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
      className,
    )}
    {...rest}
  >
    {children}
  </kbd>
));

/** A container for a sequence of keyboard keys. */
export const KbdGroup = view<Native<'kbd'> & Styled>(({ class: className, children, ...rest }) => (
  <kbd data-slot="kbd-group" class={cn('inline-flex items-center gap-1', className)} {...rest}>
    {children}
  </kbd>
));
