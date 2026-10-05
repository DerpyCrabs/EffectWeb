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
