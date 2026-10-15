import { view } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

/** A native table inside a horizontal overflow container. */
export const Table = view<Native<'table'> & Styled>(({ class: className, children, ...rest }) => (
  <div data-slot="table-container" class="relative w-full overflow-x-auto">
    <table data-slot="table" class={cn('w-full caption-bottom text-sm', className)} {...rest}>
      {children}
    </table>
  </div>
));

/** The thead section of a table. */
export const TableHeader = view<Native<'thead'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <thead data-slot="table-header" class={cn('[&_tr]:border-b', className)} {...rest}>
      {children}
    </thead>
  ),
);

/** The tbody section of a table. */
export const TableBody = view<Native<'tbody'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <tbody data-slot="table-body" class={cn('[&_tr:last-child]:border-0', className)} {...rest}>
      {children}
    </tbody>
  ),
);

/** The tfoot section of a table. */
export const TableFooter = view<Native<'tfoot'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <tfoot
      data-slot="table-footer"
      class={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...rest}
    >
      {children}
    </tfoot>
  ),
);

/** A native table row with optional selected styling. */
export const TableRow = view<Native<'tr'> & Styled & { readonly selected?: boolean | undefined }>(
  ({ class: className, selected, children, ...rest }) => (
    <tr
      data-slot="table-row"
      data-state={selected ? 'selected' : undefined}
      class={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  ),
);

/** A native header cell. Use scope to identify its row or column. */
export const TableHead = view<Native<'th'> & Styled>(({ class: className, children, ...rest }) => (
  <th
    data-slot="table-head"
    class={cn(
      'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0',
      className,
    )}
    {...rest}
  >
    {children}
  </th>
));

/** A native data cell. */
export const TableCell = view<Native<'td'> & Styled>(({ class: className, children, ...rest }) => (
  <td
    data-slot="table-cell"
    class={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
    {...rest}
  >
    {children}
  </td>
));

/** A native caption for a table. */
export const TableCaption = view<Native<'caption'> & Styled>(
  ({ class: className, children, ...rest }) => (
    <caption
      data-slot="table-caption"
      class={cn('mt-4 text-sm text-muted-foreground', className)}
      {...rest}
    >
      {children}
    </caption>
  ),
);
