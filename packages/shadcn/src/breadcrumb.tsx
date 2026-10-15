import { view } from 'effectweb';
import ChevronRight from '@effectweb/lucide/icons/chevron-right';
import Ellipsis from '@effectweb/lucide/icons/ellipsis';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A navigation landmark for the current location in a hierarchy. */
export const Breadcrumb = view<Native<'nav'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <nav aria-label="breadcrumb" data-slot="breadcrumb" class={cn(className)} {...rest}>
      {children}
    </nav>
  ),
);

/** The ordered list of breadcrumb items. */
export const BreadcrumbList = view<Native<'ol'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <ol
      data-slot="breadcrumb-list"
      class={cn(
        'flex flex-wrap items-center gap-1.5 text-sm wrap-break-word text-muted-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </ol>
  ),
);

/** One breadcrumb list item. */
export const BreadcrumbItem = view<Native<'li'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <li
      data-slot="breadcrumb-item"
      class={cn('inline-flex items-center gap-1', className)}
      {...rest}
    >
      {children}
    </li>
  ),
);

/** An anchor for an ancestor location. */
export const BreadcrumbLink = view<Native<'a'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <a
      data-slot="breadcrumb-link"
      class={cn('transition-colors hover:text-foreground', className)}
      {...rest}
    >
      {children}
    </a>
  ),
);

/** The current breadcrumb location, marked with aria-current. */
export const BreadcrumbPage = view<Native<'span'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      class={cn('font-normal text-foreground', className)}
      {...rest}
    >
      {children}
    </span>
  ),
);

/** A decorative separator between breadcrumb items. */
export const BreadcrumbSeparator = view<Native<'li'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      class={cn('[&>svg]:size-3.5', className)}
      {...rest}
    >
      {children ?? <ChevronRight class="cn-rtl-flip" />}
    </li>
  ),
);

/** A decorative indicator for omitted breadcrumb levels. */
export const BreadcrumbEllipsis = view<Native<'span'> & { readonly class?: string | undefined }>(
  ({ class: className, ...rest }) => (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      class={cn('flex size-5 items-center justify-center [&>svg]:size-4', className)}
      {...rest}
    >
      <Ellipsis />
      <span class="sr-only">More</span>
    </span>
  ),
);
