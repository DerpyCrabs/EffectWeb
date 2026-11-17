import { list, view, type JSX } from 'effectweb';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './table.js';

export interface DataTableColumn {
  readonly id: string;
  readonly label: string;
  readonly sort?: 'ascending' | 'descending' | 'none';
  readonly onSort?: () => void;
}
export interface DataTableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, JSX.Element>>;
}
/** Renders a keyed table projection. Sorting and pagination can be owned by TanStack Table or the caller. */
export const DataTable = view<{
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  empty?: JSX.Element;
}>(({ columns, rows, empty }) => (
  <Table>
    <TableHeader>
      <TableRow>
        {list(
          columns,
          (c) => c.id,
          (c) => (
            <TableHead scope="col" aria-sort={c.sort}>
              {c.onSort ? (
                <button type="button" onClick={c.onSort}>
                  {c.label}
                </button>
              ) : (
                c.label
              )}
            </TableHead>
          ),
        )}
      </TableRow>
    </TableHeader>
    <TableBody>
      {list(
        rows,
        (r) => r.id,
        (row) => (
          <TableRow>
            {list(
              columns,
              (c) => c.id,
              (c) => (
                <TableCell>{row.cells[c.id]}</TableCell>
              ),
            )}
          </TableRow>
        ),
      )}
      {!rows.length ? (
        <TableRow>
          <TableCell colSpan={Math.max(1, columns.length)}>{empty ?? 'No results'}</TableCell>
        </TableRow>
      ) : null}
    </TableBody>
  </Table>
));
