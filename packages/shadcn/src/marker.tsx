import { view } from 'effectweb';
import type { Native, Styled } from './types.js';
import { cn, cva, type VariantProps } from './cn.js';

/** Classes for marker variants. */
export const markerVariants = cva(
  "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
  {
    variants: {
      variant: {
        default: '',
        separator:
          'before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border',
        border: 'border-b border-border pb-2',
      },
    },
  },
);

/** Marker part of the marker component. */
export const Marker = view<(Native<'div'> & Styled) & VariantProps<typeof markerVariants>>(
  ({ class: className, variant = 'default', ...props }) => {
    return (
      <div
        data-slot="marker"
        data-variant={variant}
        class={cn(markerVariants({ variant }), className)}
        {...props}
      />
    );
  },
);

/** Marker icon part of the marker component. */
export const MarkerIcon = view<Native<'span'> & Styled>(({ class: className, ...props }) => {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      class={cn("size-4 shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    />
  );
});

/** Marker content part of the marker component. */
export const MarkerContent = view<Native<'span'> & Styled>(({ class: className, ...props }) => {
  return (
    <span
      data-slot="marker-content"
      class={cn(
        'min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
});
