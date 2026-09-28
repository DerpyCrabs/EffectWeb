import { expect, test } from 'vite-plus/test';
import {
  createTable,
  tableFeatures,
  rowExpandingFeature,
  rowSelectionFeature,
  createExpandedRowModel,
} from './index.js';

test('projects mutable table state without freezing internals; updates data and releases subscriptions', async () => {
  const features = tableFeatures({
    rowExpandingFeature,
    rowSelectionFeature,
    expandedRowModel: createExpandedRowModel(),
  });
  type Item = { id: string; children?: Item[] };
  const controller = createTable(
    {
      features,
      data: [{ id: 'root', children: [{ id: 'child' }] }] as Item[],
      columns: [{ id: 'id', accessorKey: 'id' }],
      getRowId: (row) => row.id,
      getSubRows: (row) => row.children,
    },
    (table) => ({
      rows: table.getRowModel().rows.map((row) => ({ id: row.id, selected: row.getIsSelected() })),
      state: table.store.state,
    }),
  );
  const before = controller.source.model();
  controller.table.toggleAllRowsExpanded(true);
  controller.table.getRow('root').toggleSelected(true);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(before.rows).toHaveLength(1);
  expect(controller.source.model().rows).toHaveLength(2);
  expect(controller.source.model().rows.every((row) => row.selected)).toBe(true);
  expect(Object.isFrozen(controller.table.store.state)).toBe(false);
  controller.table.setOptions((previous) => ({ ...previous, data: [{ id: 'new' }] }));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(controller.source.model().rows[0]!.id).toBe('new');
  let changes = 0;
  controller.source.subscribe(() => {
    changes++;
  });
  controller.dispose();
  controller.table.toggleAllRowsSelected(false);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(changes).toBe(0);
});
