import { view } from 'effectweb';
import { cn, cva, type VariantProps } from './cn.js';
import { Separator } from './separator.js';
import type { Native, Styled } from './types.js';

/** Classes for a group of adjoining buttons, horizontal or vertical. */
export const buttonGroupVariants = cva(
  "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2 [&>*]:focus-visible:relative [&>*]:focus-visible:z-10 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none',
        vertical:
          'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none',
      },
    },
    defaultVariants: { orientation: 'horizontal' },
  },
);
/** Buttons, inputs and select triggers joined into one control. */
export const ButtonGroup = view<Native<'div'> & Styled & VariantProps<typeof buttonGroupVariants>>(
  ({ class: className, orientation, children, ...rest }) => (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation ?? 'horizontal'}
      class={cn(buttonGroupVariants({ orientation }), className)}
      {...rest}
    >
      {children}
    </div>
  ),
);
/** Static text that sits inside a button group. */
export const ButtonGroupText = view<Native<'div'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <div
      class={cn(
        "flex items-center gap-2 rounded-md border bg-muted px-4 text-sm font-medium shadow-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  ),
);
/** A divider between the controls of a button group. */
export const ButtonGroupSeparator = view<Parameters<typeof Separator>[0]>(
  ({ class: className, orientation, ...rest }) => (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation ?? 'vertical'}
      class={cn(
        'relative m-0! self-stretch bg-input data-[orientation=vertical]:h-auto',
        className,
      )}
      {...rest}
    />
  ),
);
