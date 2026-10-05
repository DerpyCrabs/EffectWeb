import {
  constructTable,
  type Table,
  type TableFeatures,
  type TableOptions,
  type RowData,
} from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import type { Source } from 'effectweb';
import { projectionSource, shareValue } from 'effectweb/advanced';

export * from '@tanstack/table-core';

/**
 * Scope one TanStack v9 table and publish a data-only projection. Do not return row,
 * column, store or table instances from project: those are mutable library resources.
 */
export interface TableController<F extends TableFeatures, T extends RowData, Model> {
  readonly table: Table<F, T>;
  readonly source: Source<Model>;
  readonly dispose: () => void;
}
export function createTable<F extends TableFeatures, T extends RowData, Model>(
  options: TableOptions<F, T>,
  project: (table: Table<F, T>) => Model,
): TableController<F, T, Model> {
  let disposed = false;
  const cleanups: Array<() => void> = [];
  const reactivity = {
    ...storeReactivityBindings(),
    addSubscription(subscription: { unsubscribe: () => void }) {
      cleanups.push(() => subscription.unsubscribe());
    },
    schedule(run: () => void) {
      queueMicrotask(() => {
        if (!disposed) run();
      });
    },
    unmount() {
      for (const stop of cleanups.splice(0).reverse()) stop();
    },
  };
  const table = constructTable<F, T>({
    ...options,
    features: { ...options.features, coreReactivityFeature: reactivity },
  });
  const source = projectionSource<Model>({
    project: () => structuredClone(project(table)),
    reconcile: (previous, next) => shareValue<Model>(previous, next),
  });
  const state = table.store.subscribe(source.changed);
  const settings = table.optionsStore?.subscribe(source.changed);
  const controller = {
    table,
    source,
    dispose() {
      if (disposed) return;
      disposed = true;
      state.unsubscribe();
      settings?.unsubscribe();
      reactivity.unmount();
      source.dispose();
    },
  };
  try {
    source.start();
    return controller;
  } catch (error) {
    controller.dispose();
    throw error;
  }
}
