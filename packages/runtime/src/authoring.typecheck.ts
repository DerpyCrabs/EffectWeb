import { defineActions } from './actions.js';

const actions = defineActions<{ count: number }>()({
  Add: (model, amount: number, label?: string) => ({
    model: { count: model.count + amount + (label?.length ?? 0) },
  }),
  Reset: () => ({ model: { count: 0 } }),
});
const dispatch = actions.bind(() => {});
defineActions<{ count: number }>()({
  Increment: (model) => {
    // @ts-expect-error Actions receive the same readonly snapshot as program updates.
    model.count++;
    return { model: { count: model.count + 1 } };
  },
});
dispatch.Add(2);
dispatch.Add(2, 'ok');
dispatch.Reset();
// @ts-expect-error The handler's required payload must be supplied.
dispatch.Add();
// @ts-expect-error Payload types come from the handler.
dispatch.Add('2');
// @ts-expect-error No invented actions.
// oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
dispatch.Missing();
// @ts-expect-error Completion messages retain their exact payload tuple.
actions.update({ count: 0 }, { type: 'Add', args: ['2'] });

import { view, type View } from './dom.js';
export const readOnlyView: View<{ title: string }, never> = view<{ title: string }>(
  (model) => model.title,
);

import { modelOwner } from './owner.js';
const owner = modelOwner({ count: 0, label: '' });
owner.edit('count', (n) => n + 1);
// @ts-expect-error Field updates preserve their value type.
owner.edit('count', () => 'bad');
// @ts-expect-error Transactions are synchronous.
const invalidTransaction = owner.transaction(async () => {});
invalidTransaction.catch(() => {});
// @ts-expect-error Unknown model fields are rejected.
owner.patch({ missing: true });

// Published fields cannot be assigned, including through the source or listeners.
// @ts-expect-error Publish changes through patch/edit.
owner.read().count = 1;
// @ts-expect-error Source reads have the same readonly contract.
owner.source.model().count = 1;
owner.source.subscribe((model) => {
  // @ts-expect-error Subscribers receive readonly published fields.
  model.count = 1;
});
const arrayOwner = modelOwner({ values: [1] });
arrayOwner.edit('values', (values) => {
  // @ts-expect-error edit receives a readonly array.
  // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
  values.push(2);
  return [...values, 2];
});

// A no-op edit can return the readonly input without copying it.
arrayOwner.edit('values', (values) => values);
