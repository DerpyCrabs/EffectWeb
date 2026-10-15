import { view, type View } from 'effectweb';
import {
  ToolbarRoot as Root,
  ToolbarButton as Button,
  ToolbarLink as Link,
  ToolbarInput as Input,
  ToolbarGroup as Group,
  ToolbarSeparator as Separator,
  type ToolbarHandle,
} from '@effectweb/base-ui/toolbar';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
export { createToolbar, type ToolbarHandle } from '@effectweb/base-ui/toolbar';
/** Styled Toolbar part with native attributes and theme classes. */
export const Toolbar = view<Native<'div'> & Styled & { readonly toolbar: ToolbarHandle }>(
  ({ class: className, ...rest }) => (
    <Root
      {...rest}
      data-slot="toolbar"
      class={cn(
        'flex items-center gap-1 rounded-lg border bg-background p-1 data-[orientation=vertical]:flex-col',
        className,
      )}
    />
  ),
);
/** Styled ToolbarButton part with native attributes and theme classes. */
export const ToolbarButton = view<Native<'button'> & Styled>(({ class: className, ...rest }) => (
  <Button
    {...rest}
    class={cn(
      'inline-flex h-8 items-center justify-center rounded-md px-2 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
      className,
    )}
  />
));
/** Styled ToolbarLink part with native attributes and theme classes. */
export const ToolbarLink: View<Native<'a'> & Styled, never> = view<Native<'a'> & Styled>(
  ({ class: className, ...rest }) => (
    <Link
      {...rest}
      class={cn(
        'rounded-md px-2 py-1 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    />
  ),
);
/** Styled ToolbarInput part with native attributes and theme classes. */
export const ToolbarInput = view<Native<'input'> & Styled>(({ class: className, ...rest }) => (
  <Input
    {...rest}
    class={cn('h-8 rounded-md border border-input bg-transparent px-2 text-sm', className)}
  />
));
/** Styled ToolbarGroup part with native attributes and theme classes. */
export const ToolbarGroup = view<Native<'div'> & Styled>(({ class: className, ...rest }) => (
  <Group {...rest} class={cn('flex items-center gap-1', className)} />
));
/** Styled ToolbarSeparator part with native attributes and theme classes. */
export const ToolbarSeparator = view<Native<'div'> & Styled & { readonly toolbar: ToolbarHandle }>(
  ({ class: className, ...rest }) => (
    <Separator
      {...rest}
      class={cn(
        'mx-1 h-5 w-px bg-border aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full',
        className,
      )}
    />
  ),
);
