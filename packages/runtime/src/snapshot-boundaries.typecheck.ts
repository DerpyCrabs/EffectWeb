import { Effect } from 'effect';
import {
  collection,
  entities,
  sequence,
  component,
  defineTasks,
  localComponent,
  pages,
  program,
  programView,
  resourceComponent,
  slot,
  taskComponent,
  taskControls,
  view,
  ViewBinding,
  type Snapshot,
} from './index.js';

type Item = { name: string; tags: string[] };
type Props = { items: Item[] };
type Model = Props & { props: Props };

/** Public composition accepts shared snapshot branches while callbacks cannot mutate them. */
export function snapshotComposition(props: Snapshot<Props>) {
  const Child = view<Props>((model) => model.items[0]?.name);
  view<Props>((model) => {
    Child({ items: model.items });
    ViewBinding({ view: Child, model, send: () => {} });
    // @ts-expect-error An explicit binding must supply the child model's shape.
    ViewBinding({ view: Child, model: { title: 'wrong model' }, send: () => {} });
    const content = slot<Props>((value) => {
      // @ts-expect-error Slot placement data is a snapshot too.
      value.items[0]!.tags.push('bad');
      return value.items[0]?.name;
    });
    return content(model);
  });
  localComponent<Props, Props>({
    init(input) {
      // @ts-expect-error Initial parent input is borrowed immutable data.
      input.items.push({ name: 'bad', tags: [] });
      return input;
    },
    view: view((model, send) => {
      send({ items: model.items });
      // @ts-expect-error Parent props remain outside local patch ownership.
      send({ props: model.props });
      return null;
    }),
  });
  component<Props, Model, never>({
    init(input) {
      // @ts-expect-error Initial input never becomes a mutable parent alias.
      input.items[0]!.name = 'bad';
      return { props: input, items: input.items };
    },
    receive(model, input) {
      // @ts-expect-error New parent input is immutable on receive too.
      input.items[0]!.tags.sort();
      return { model: { ...model, props: input, items: input.items } };
    },
    update: (model) => ({ model }),
    view: view((model) => model.items[0]?.name),
  });
  programView<Props, Props, never>({
    create(input) {
      // @ts-expect-error Program adapters cannot mutate borrowed props.
      input.items.pop();
      return program<Props, never>({ initial: input, update: (model) => ({ model }) });
    },
    receive(_source, input) {
      // @ts-expect-error Program adapter receive preserves the same boundary.
      input.items[0]!.tags[0] = 'bad';
    },
    view: Child,
  });
  const source = program<Props, never>({ initial: props, update: (model) => ({ model }) });
  source.dispose();
}

export function explicitViewBindings() {
  const Child = view<number, 'Increment'>((count) => count);
  ViewBinding({ view: Child, model: 1, send: (_message: 'Increment') => {} });
  // @ts-expect-error Dispatchers must accept the child's messages.
  ViewBinding({ view: Child, model: 1, send: (_message: 'Other') => {} });
  const Ordinary = view<{ model: string; send: () => void }>((props) => props.model);
  Ordinary({ model: 'ordinary prop', send: () => {} });
}

export function taskSnapshotBoundaries(props: Snapshot<Props>) {
  taskComponent<Props, Props, void, number>({
    init: (input) => input,
    identity(input) {
      // @ts-expect-error Identity selection cannot mutate published props.
      input.items.reverse();
      return input.items[0]?.name;
    },
    task: { policy: 'replace', run: (model) => Effect.succeed(model.items.length) },
    view: view((model, send) => {
      taskControls<Props, void>(send).patch({ items: model.items });
      // @ts-expect-error Task result ownership cannot be patched through local fields.
      taskControls<Props, void>(send).patch({ task: model.task });
      return null;
    }),
  });
  const builder = defineTasks<Props, Props>({
    init(input) {
      // @ts-expect-error Task builder initialization receives immutable parent data.
      input.items[0]!.tags.push('bad');
      return input;
    },
    identity(input) {
      // @ts-expect-error Task builder identity receives immutable parent data.
      input.items.shift();
      return input.items[0]?.name;
    },
  }).tasks({ Count: { policy: 'replace', run: (model) => Effect.succeed(model.items.length) } });
  const source = builder.create(props);
  builder.receive(source, props);
  builder.controls(source.send).patch({ items: source.model().items });
  // @ts-expect-error Parent props remain outside task field ownership.
  builder.controls(source.send).patch({ props });
  source.dispose();
}

export function resourceSnapshotBoundaries(props: Snapshot<Props>) {
  resourceComponent<Props, number>({
    request(input) {
      // @ts-expect-error Request selection cannot mutate published props.
      input.items[0]!.name = 'bad';
      return { key: 'count', load: () => Effect.succeed(input.items.length) };
    },
    view: view(() => null),
  });
  const pagination = pages<Props, Item, { offsets: number[] }>({
    key(input) {
      // @ts-expect-error Page identity reads immutable input.
      input.items.pop();
      return 'items';
    },
    load(input, cursor) {
      // @ts-expect-error Load props can be retained published data.
      input.items[0]!.tags.push('bad');
      // @ts-expect-error A continuation cursor belongs to the previous snapshot.
      cursor?.offsets.push(1);
      return Effect.succeed({ items: [], next: undefined });
    },
    itemKey(item) {
      // @ts-expect-error Existing result items cannot be mutated by identity selection.
      item.tags.sort();
      return item.name;
    },
  });
  const source = pagination.create(props);
  pagination.receive(source.model(), props);
  pagination.update(source.model(), { type: 'More' });
  // @ts-expect-error A newly assembled initial model still borrows immutable parent input.
  pagination.init(props).props.items.push({ name: 'bad', tags: [] });
  source.dispose();
}

export function symbolIndexIsNotAnOpaqueBrand(
  model: Snapshot<{ [key: symbol]: unknown; items: string[] }>,
) {
  // @ts-expect-error A broad symbol index signature does not opt out of snapshot protection.
  model.items.push('bad');
}

export function collectionSnapshotBoundaries(
  model: Snapshot<{ items: (Item & { id: string })[] }>,
) {
  const rows = collection<Item & { id: string }>((item) => {
    // @ts-expect-error Identity selection borrows immutable items.
    item.tags.push('bad');
    return item.id;
  });
  rows
    .from(model.items)
    .filter((item) => item.tags.length > 0)
    .map((item) => {
      // @ts-expect-error Collection rendering cannot mutate nested snapshot data.
      item.tags.push('bad');
      return item.name;
    });
  rows.from([{ id: 'new', name: 'New', tags: [] }]);
  rows.share(model.items, model.items);
  const shared = rows.share(model.items, [{ id: 'new', name: 'New', tags: [] }]);
  // @ts-expect-error Sharing may return the published readonly array.
  shared.push({ id: 'bad', name: 'Bad', tags: [] });
  // @ts-expect-error Sharing may reuse a published item's nested array.
  shared[0]!.tags.push('bad');
  const owned = rows.share([{ id: 'a', name: 'A', tags: ['a'] }], []);
  owned.push({ id: 'b', name: 'B', tags: [] });
  entities(model.items).map((item) => {
    // @ts-expect-error Entity helpers preserve readonly access.
    item.tags.sort();
    return item.id;
  });
  sequence([{ tags: ['a'] }]).map((item) => {
    // @ts-expect-error Positional helpers borrow immutable values too.
    item.tags.pop();
    return item.tags.length;
  });
}
