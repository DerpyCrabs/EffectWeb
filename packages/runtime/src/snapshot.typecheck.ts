import { Effect } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { defineActions } from './actions.js';
import { modelOwner } from './owner.js';
import { program, type Transition } from './program.js';
import { available } from './resource.js';
import type { Snapshot, snapshotOpaque } from './snapshot.js';
import { view } from './dom.js';

type Model = { items: { text: string; tags: string[] }[]; selected: number };

export function publishedSnapshotTypes() {
  const actions = defineActions<Model>()({
    Rename: (model, text: string): Transition<Model, never> => ({
      model: { ...model, items: model.items.map((item) => ({ ...item, text })) },
    }),
    Keep: (model) => ({ model }),
    Invalid: (model) => {
      // @ts-expect-error Published arrays cannot be mutated.
      model.items.push({ text: 'bad', tags: [] });
      // @ts-expect-error Published nested objects cannot be mutated.
      model.items[0]!.text = 'bad';
      // @ts-expect-error Deeply nested arrays cannot be mutated.
      model.items[0]!.tags.sort();
      return { model };
    },
  });
  const app = program({ initial: { items: [], selected: 0 } as Model, update: actions.update });
  // @ts-expect-error Reads have the same immutable contract as reducers.
  app.model().items.pop();
  app.subscribe((model) => {
    // @ts-expect-error Subscribers cannot change published state.
    model.items[0]!.tags[0] = 'bad';
  });
  const owner = modelOwner({ items: [{ text: 'first', tags: ['a'] }] });
  owner.edit('items', (items) => items.map((item) => ({ ...item, text: 'next' })));
  owner.edit('items', (items) => items);
  // Reusing immutable branches is a normal patch, not a cast at the application boundary.
  owner.patch({ items: owner.read().items });
  view<Model>((model) => {
    // @ts-expect-error View render inputs are immutable too.
    model.items.splice(0, 1);
    return model.items[0]?.text;
  });
  app.dispose();
  owner.dispose();
}

class Service {
  declare readonly [snapshotOpaque]?: true;
  private count = 0;
  increment() {
    return ++this.count;
  }
}

export function opaqueAndResultTypes(
  model: Snapshot<{
    service: Service;
    element: HTMLElement;
    effect: Effect.Effect<number>;
    callback: (text: string) => number;
    result: AsyncResult.AsyncResult<{ names: string[] }>;
    map: Map<string, { count: number }>;
    tuple: [string, { values: number[] }];
  }>,
) {
  const service: Service = model.service;
  service.increment();
  model.element.focus();
  Effect.runSync(model.effect);
  model.callback('still callable');
  const data = available(model.result);
  // @ts-expect-error Successful query/task data remains deeply readonly after extraction.
  data?.names.push('bad');
  // @ts-expect-error Mutable container APIs are unavailable from a snapshot.
  model.map.set('bad', { count: 1 });
  // @ts-expect-error Container values are immutable too.
  model.map.get('x')!.count++;
  // @ts-expect-error Tuple elements retain recursive protection.
  model.tuple[1].values.push(1);
}

export function rootAndOptionalResourceTypes(
  callback: Snapshot<(value: string) => number>,
  effect: Snapshot<Effect.Effect<number>>,
  map: Snapshot<Map<string, { count: number }>>,
  model: Snapshot<{ service?: Service; callback?: (value: string) => number }>,
) {
  callback('callable root');
  Effect.runSync(effect);
  const service: Service | undefined = model.service;
  service?.increment();
  model.callback?.('callable optional field');
  // @ts-expect-error Root containers have the same readonly contract as nested ones.
  map.set('x', { count: 1 });
}
