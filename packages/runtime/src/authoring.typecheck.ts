import { Effect } from 'effect';
import { defineActions } from './actions.js';
import { compiled } from './dom.js';
import { taskComponent, taskControls } from './task.js';

const actions = defineActions<{ count: number }>()({
  Add: (model, amount: number, label?: string) => ({
    model: { count: model.count + amount + (label?.length ?? 0) },
  }),
  Reset: () => ({ model: { count: 0 } }),
});
const dispatch = actions.bind(() => {});
dispatch.Add(2);
dispatch.Add(2, 'ok');
dispatch.Reset();
// @ts-expect-error The handler's required payload must be supplied.
dispatch.Add();
// @ts-expect-error Payload types come from the handler.
dispatch.Add('2');
// @ts-expect-error No invented actions.
dispatch.Missing();
// @ts-expect-error Completion messages retain their exact payload tuple.
actions.update({ count: 0 }, { type: 'Add', args: ['2'] });

taskComponent<{ id: string }, { text: string }, number, string>({
  init: () => ({ text: '' }),
  identity: (props) => props.id,
  task: { policy: 'replace', run: (model, count) => Effect.succeed(model.text.repeat(count)) },
  view: compiled((scope) => {
    const controls = taskControls(scope.send);
    controls.patch({ text: 'updated' });
    controls.run(2);
    controls.cancel();
    // @ts-expect-error Task inputs retain their declaration type.
    controls.run('2');
    // @ts-expect-error Props belong to the parent, not editable fields.
    controls.patch({ props: { id: 'other' } });
    // @ts-expect-error Task settlement belongs to the framework.
    controls.patch({ task: undefined });
    // @ts-expect-error Field names are checked.
    controls.patch({ missing: true });
  }),
});

// Annotate the task boundary's result so TypeScript contextualizes the later view
// before checking its body; no component/model/message type arguments are needed.
taskComponent({
  init: (_props: { id: string }) => ({ text: '' }),
  task: {
    policy: 'replace',
    run: (model, count: number): Effect.Effect<string, unknown> =>
      Effect.succeed(model.text.repeat(count)),
  },
  view: compiled((scope) => {
    const controls = taskControls(scope.send);
    controls.run(2);
    controls.patch({ text: 'text' });
    if (scope.value.task._tag === 'Success') {
      const text: string = scope.value.task.value;
      // @ts-expect-error Task success result is inferred from run, not any or unknown.
      const wrong: number = scope.value.task.value;
      void text;
      void wrong;
    }
    // @ts-expect-error Completion messages are private to the framework.
    scope.send({ type: 'Succeeded', value: 'forged' });
    // @ts-expect-error Input is inferred from run's parameter.
    controls.run('wrong');
    // @ts-expect-error Fields are inferred from init.
    controls.patch({ text: 123 });
  }),
});

// Pure views need only their input type; they emit no messages.
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
void owner.transaction(async () => {});
// @ts-expect-error Unknown model fields are rejected.
owner.patch({ missing: true });
