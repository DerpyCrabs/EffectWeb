import { view } from 'effectweb';
import { cn, cva, type VariantProps } from './cn.js';
import type { Native, Styled } from './types.js';

type DivProps = Native<'div'> & Styled;

/** A container for an empty state. */
export const Empty = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="empty"
    class={cn(
      'flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** The media, title and description area of an empty state. */
export const EmptyHeader = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="empty-header"
    class={cn('flex max-w-sm flex-col items-center gap-2', className)}
    {...rest}
  >
    {children}
  </div>
));

/** Classes for plain or icon media in an empty state. */
export const emptyMediaVariants = cva(
  'mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** The visual shown above an empty-state title. */
export const EmptyMedia = view<DivProps & VariantProps<typeof emptyMediaVariants>>(
  ({ class: className, variant, children, ...rest }) => (
    <div
      data-slot="empty-icon"
      data-variant={variant ?? 'default'}
      class={cn(emptyMediaVariants({ variant }), className)}
      {...rest}
    >
      {children}
    </div>
  ),
);

/** The title text of an empty state. */
export const EmptyTitle = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="empty-title"
    class={cn('cn-font-heading text-sm font-medium tracking-tight', className)}
    {...rest}
  >
    {children}
  </div>
));

/** Supporting text for an empty state. */
export const EmptyDescription = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="empty-description"
    class={cn(
      'text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));

/** The content or actions beneath an empty-state header. */
export const EmptyContent = view<DivProps>(({ class: className, children, ...rest }) => (
  <div
    data-slot="empty-content"
    class={cn(
      'flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
));
