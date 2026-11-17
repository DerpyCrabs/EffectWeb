import { view } from 'effectweb';
import type { Native, Styled } from './types.js';
import { cn, cva, type VariantProps } from './cn.js';

/** Bubble group part of the bubble component. */
export const BubbleGroup = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div data-slot="bubble-group" class={cn('flex min-w-0 flex-col gap-2', className)} {...props} />
  );
});

const bubbleVariants = cva(
  'group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full',
  {
    variants: {
      variant: {
        default:
          '*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80',
        secondary:
          '*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]',
        muted:
          '*:data-[slot=bubble-content]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]',
        tinted:
          '*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.93_calc(c*0.4)_h)] *:data-[slot=bubble-content]:text-foreground dark:*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.3_calc(c*0.4)_h)] [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.88_calc(c*0.5)_h)] dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.35_calc(c*0.5)_h)]',
        outline:
          '*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30',
        ghost:
          'border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50',
        destructive:
          '*:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive dark:*:data-[slot=bubble-content]:bg-destructive/20 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** Bubble part of the bubble component. */
export const Bubble = view<
  (Native<'div'> & Styled) & VariantProps<typeof bubbleVariants> & { align?: 'start' | 'end' }
>(({ variant = 'default', align = 'start', class: className, ...props }) => {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      class={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
});

/** Bubble content part of the bubble component. */
export const BubbleContent = view<Native<'div'> & Styled>(({ class: className, ...props }) => {
  return (
    <div
      data-slot="bubble-content"
      class={cn(
        'w-fit max-w-full min-w-0 overflow-hidden rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
});

const bubbleReactionsVariants = cva(
  'absolute z-10 flex w-fit shrink-0 items-center justify-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-sm ring-3 ring-card has-[button]:p-0',
  {
    variants: {
      side: { top: 'top-0 -translate-y-3/4', bottom: 'bottom-0 translate-y-3/4' },
      align: { start: 'left-3', end: 'right-3' },
    },
    defaultVariants: { side: 'bottom', align: 'end' },
  },
);

/** Bubble reactions part of the bubble component. */
export const BubbleReactions = view<
  (Native<'div'> & Styled) & { align?: 'start' | 'end'; side?: 'top' | 'bottom' }
>(({ side = 'bottom', align = 'end', class: className, ...props }) => {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      class={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  );
});
