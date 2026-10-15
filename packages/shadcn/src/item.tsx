import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
/** Styled ItemGroup part with native attributes and theme classes. */
export const ItemGroup = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    role="list"
    data-slot="item-group"
    class={cn(
      'group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2',
      className,
    )}
    {...rest}
  />
));
/** Styled ItemContent part with native attributes and theme classes. */
export const ItemContent = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="item-content"
    class={cn(
      'flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0 [&+[data-slot=item-content]]:flex-none',
      className,
    )}
    {...rest}
  />
));
/** Styled ItemTitle part with native attributes and theme classes. */
export const ItemTitle = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="item-title"
    class={cn(
      'line-clamp-1 flex w-fit items-center gap-2 text-sm leading-snug font-medium underline-offset-4',
      className,
    )}
    {...rest}
  />
));
/** Styled ItemDescription part with native attributes and theme classes. */
export const ItemDescription = view<Native<'p'> & Styled>(({ class: className, ...rest }) => (
  <p
    data-slot="item-description"
    class={cn(
      'line-clamp-2 text-left text-sm leading-normal font-normal text-muted-foreground group-data-[size=xs]/item:text-xs [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
      className,
    )}
    {...rest}
  />
));
/** Styled ItemActions part with native attributes and theme classes. */
export const ItemActions = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div data-slot="item-actions" class={cn('flex items-center gap-2', className)} {...rest} />
));
/** Styled ItemHeader part with native attributes and theme classes. */
export const ItemHeader = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="item-header"
    class={cn('flex basis-full items-center justify-between gap-2', className)}
    {...rest}
  />
));
/** Styled ItemFooter part with native attributes and theme classes. */
export const ItemFooter = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    data-slot="item-footer"
    class={cn('flex basis-full items-center justify-between gap-2', className)}
    {...rest}
  />
));
/** Styled ItemSeparator part with native attributes and theme classes. */
export const ItemSeparator = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <div
    role="separator"
    data-slot="item-separator"
    class={cn('my-2 h-px bg-border', className)}
    {...rest}
  />
));
/** Styled Item part with native attributes and theme classes. */
export const Item = view<
  Native<'div'> &
    Styled & {
      readonly variant?: 'default' | 'outline' | 'muted' | undefined;
      readonly size?: 'default' | 'sm' | 'xs' | undefined;
    }
>(({ class: className, variant = 'default', size = 'default', ...rest }) => (
  <div
    role="listitem"
    data-slot="item"
    data-variant={variant}
    data-size={size}
    class={cn(
      'group/item flex w-full flex-wrap items-center rounded-lg border text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-muted',
      variant === 'outline'
        ? 'border-border'
        : variant === 'muted'
          ? 'border-transparent bg-muted/50'
          : 'border-transparent',
      size === 'xs'
        ? 'gap-2 px-2.5 py-2 in-data-[slot=dropdown-menu-content]:p-0'
        : 'gap-2.5 px-3 py-2.5',
      className,
    )}
    {...rest}
  />
));
/** Styled ItemMedia part with native attributes and theme classes. */
export const ItemMedia = view<
  Native<'div'> & Styled & { readonly variant?: 'default' | 'icon' | 'image' | undefined }
>(({ class: className, variant = 'default', ...rest }) => (
  <div
    data-slot="item-media"
    data-variant={variant}
    class={cn(
      'flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none',
      variant === 'image'
        ? 'size-10 overflow-hidden rounded-sm group-data-[size=sm]/item:size-8 group-data-[size=xs]/item:size-6 [&_img]:size-full [&_img]:object-cover'
        : variant === 'icon'
          ? "[&_svg:not([class*='size-'])]:size-4"
          : 'bg-transparent',
      className,
    )}
    {...rest}
  />
));
