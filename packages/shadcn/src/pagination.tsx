import { view } from 'effectweb';
import ChevronLeft from '@effectweb/lucide/icons/chevron-left';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';
import Ellipsis from '@effectweb/lucide/icons/ellipsis';
import { buttonVariants } from './button.js';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A navigation landmark for page links. */
export const Pagination = view<Native<'nav'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      class={cn('mx-auto flex w-full justify-center', className)}
      {...rest}
    >
      {children}
    </nav>
  ),
);

/** The list of pagination controls. */
export const PaginationContent = view<Native<'ul'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <ul data-slot="pagination-content" class={cn('flex items-center gap-0.5', className)} {...rest}>
      {children}
    </ul>
  ),
);

/** One pagination list item. */
export const PaginationItem = view<Native<'li'> & Styled>(({ children, ...rest }) => (
  <li data-slot="pagination-item" {...rest}>
    {children}
  </li>
));

type LinkProps = Native<'a'> &
  Styled & {
    readonly active?: boolean | undefined;
    readonly size?: 'default' | 'icon' | undefined;
  };

/** A page anchor with an optional active state. */
export const PaginationLink = view<LinkProps>(
  ({ class: className, active, size, children, ...rest }) => (
    <a
      aria-current={active ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={active ? 'true' : undefined}
      class={cn(
        buttonVariants({ variant: active ? 'outline' : 'ghost', size: size ?? 'icon' }),
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
);

/** An anchor to the previous page, with an optional text label. */
export const PaginationPrevious = view<LinkProps & { readonly text?: string | undefined }>(
  ({ class: className, text, ...rest }) => (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      class={cn('pl-1.5!', className)}
      {...rest}
    >
      <ChevronLeft data-icon="inline-start" class="cn-rtl-flip" />
      <span class="hidden sm:block">{text ?? 'Previous'}</span>
    </PaginationLink>
  ),
);

/** An anchor to the next page, with an optional text label. */
export const PaginationNext = view<LinkProps & { readonly text?: string | undefined }>(
  ({ class: className, text, ...rest }) => (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      class={cn('pr-1.5!', className)}
      {...rest}
    >
      <span class="hidden sm:block">{text ?? 'Next'}</span>
      <ChevronRight data-icon="inline-end" class="cn-rtl-flip" />
    </PaginationLink>
  ),
);

/** A decorative indicator for omitted pages. */
export const PaginationEllipsis = view<Native<'span'> & { readonly class?: string | undefined }>(
  ({ class: className, ...rest }) => (
    <span
      aria-hidden="true"
      data-slot="pagination-ellipsis"
      class={cn(
        "flex size-8 items-center justify-center [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...rest}
    >
      <Ellipsis />
      <span class="sr-only">More pages</span>
    </span>
  ),
);
