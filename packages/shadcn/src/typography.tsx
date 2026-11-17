import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
/** Styled h1 for h1 typography. */
export const TypographyH1 = view<Native<'h1'> & Styled>(({ class: className, ...props }) => (
  <h1 class={cn('text-4xl font-extrabold tracking-tight', className)} {...props} />
));
/** Styled h2 for h2 typography. */
export const TypographyH2 = view<Native<'h2'> & Styled>(({ class: className, ...props }) => (
  <h2 class={cn('border-b pb-2 text-3xl font-semibold tracking-tight', className)} {...props} />
));
/** Styled h3 for h3 typography. */
export const TypographyH3 = view<Native<'h3'> & Styled>(({ class: className, ...props }) => (
  <h3 class={cn('text-2xl font-semibold', className)} {...props} />
));
/** Styled h4 for h4 typography. */
export const TypographyH4 = view<Native<'h4'> & Styled>(({ class: className, ...props }) => (
  <h4 class={cn('text-xl font-semibold', className)} {...props} />
));
/** Styled p for p typography. */
export const TypographyP = view<Native<'p'> & Styled>(({ class: className, ...props }) => (
  <p class={cn('leading-7', className)} {...props} />
));
/** Styled blockquote for blockquote typography. */
export const TypographyBlockquote = view<Native<'blockquote'> & Styled>(
  ({ class: className, ...props }) => (
    <blockquote class={cn('border-l-2 pl-6 italic', className)} {...props} />
  ),
);
/** Styled ul for list typography. */
export const TypographyList = view<Native<'ul'> & Styled>(({ class: className, ...props }) => (
  <ul class={cn('ml-6 list-disc', className)} {...props} />
));
/** Styled code for inlinecode typography. */
export const TypographyInlineCode = view<Native<'code'> & Styled>(
  ({ class: className, ...props }) => (
    <code class={cn('rounded bg-muted px-1 font-mono text-sm', className)} {...props} />
  ),
);
/** Styled p for lead typography. */
export const TypographyLead = view<Native<'p'> & Styled>(({ class: className, ...props }) => (
  <p class={cn('text-xl text-muted-foreground', className)} {...props} />
));
/** Styled div for large typography. */
export const TypographyLarge = view<Native<'div'> & Styled>(({ class: className, ...props }) => (
  <div class={cn('text-lg font-semibold', className)} {...props} />
));
/** Styled small for small typography. */
export const TypographySmall = view<Native<'small'> & Styled>(({ class: className, ...props }) => (
  <small class={cn('text-sm font-medium', className)} {...props} />
));
/** Styled p for muted typography. */
export const TypographyMuted = view<Native<'p'> & Styled>(({ class: className, ...props }) => (
  <p class={cn('text-sm text-muted-foreground', className)} {...props} />
));
