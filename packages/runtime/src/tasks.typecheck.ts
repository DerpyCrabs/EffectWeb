import { Effect } from 'effect';
import { defineTasks, ownedTasks } from './tasks.js';
import { modelOwner } from './owner.js';
import { lifetime } from './session.js';
import * as AsyncResult from 'effect/reactivity/AsyncResult';

export function taskInputs() {
  const definition = defineTasks({ init: () => ({ text: 'draft' }) }).tasks({
    optional: { policy: 'drop', run: (_model, input?: string) => Effect.succeed(input) },
    defaulted: { policy: 'drop', run: (_model, input = 'default') => Effect.succeed(input) },
    required: { policy: 'drop', run: (_model, input: string) => Effect.succeed(input) },
    requiredUndefined: {
      policy: 'drop',
      run: (_model, input: string | undefined) => Effect.succeed(input),
    },
    noInput: { policy: 'drop', run: () => Effect.succeed('no input') },
    modelOnly: { policy: 'drop', run: (model) => Effect.succeed(model.text) },
    voidInput: { policy: 'drop', run: (_model, _input: void) => Effect.succeed('void input') },
  });
  const source = definition.create(undefined);
  const controls = definition.controls(source.send);
  controls.run('optional');
  controls.run('optional', undefined);
  controls.run('optional', 'custom');
  controls.run('defaulted');
  controls.run('defaulted', undefined);
  controls.run('defaulted', 'custom');
  controls.run('required', 'custom');
  controls.run('requiredUndefined', undefined);
  controls.run('noInput');
  controls.run('noInput', undefined);
  controls.run('modelOnly');
  controls.run('voidInput');
  // @ts-expect-error Optional inputs still reject the wrong payload type.
  controls.run('optional', 1);
  // @ts-expect-error Defaulted inputs still reject the wrong payload type.
  controls.run('defaulted', 1);
  // @ts-expect-error Required inputs cannot be omitted.
  controls.run('required');
  // @ts-expect-error Required inputs still reject the wrong payload type.
  controls.run('required', 1);
  // @ts-expect-error An explicit undefined union does not make the parameter optional.
  controls.run('requiredUndefined');
  // @ts-expect-error Tasks without inputs cannot receive an unrelated payload.
  controls.run('noInput', 'extra');
  // @ts-expect-error A model parameter is not a task payload.
  controls.run('modelOnly', 'extra');
  // @ts-expect-error Named component tasks accept only one input value.
  controls.run('optional', 'custom', 'extra');

  source.send({ type: 'Run', task: 'optional', input: 'custom' });
  source.send({ type: 'Run', task: 'optional', input: undefined });
  source.send({ type: 'Run', task: 'defaulted', input: 'custom' });
  source.send({ type: 'Run', task: 'defaulted', input: undefined });
  // @ts-expect-error Public task messages retain their inferred input type too.
  source.send({ type: 'Run', task: 'optional', input: 1 });
  source.dispose();
}

export function ownedTaskResultKeys() {
  const owner = modelOwner<{
    saved: AsyncResult.AsyncResult<number, string>;
    loose: AsyncResult.AsyncResult<unknown, unknown>;
    label: string;
  }>({ saved: AsyncResult.initial(), loose: AsyncResult.initial(), label: '' });
  const actions = ownedTasks(owner, {
    save: { policy: 'drop', result: 'saved', run: (text: string) => Effect.succeed(text.length) },
    load: { policy: 'replace', result: 'loose', run: () => Effect.succeed({ rows: [1] }) },
    plain: { policy: 'queue', run: (by: number) => Effect.sync(() => by) },
  });
  actions.save('text');
  actions.load();
  actions.plain(1);
  // Destructuring must not feed the binding pattern back into inference.
  const { save } = ownedTasks(owner, {
    save: { policy: 'drop', result: 'saved', run: (text: string) => Effect.succeed(text.length) },
  });
  save('text');
  const { plain } = ownedTasks(lifetime(), {
    plain: { policy: 'drop', run: (by: number) => Effect.sync(() => by) },
  });
  plain(1);
  ownedTasks(owner, {
    // @ts-expect-error The key must hold the task's AsyncResult.
    wrong: { policy: 'drop', result: 'label', run: () => Effect.succeed(1) },
  });
  ownedTasks(owner, {
    // @ts-expect-error The task's error type must fit the key.
    error: { policy: 'drop', result: 'saved', run: () => Effect.fail(new Error('x')) },
  });
  // @ts-expect-error Result keys need a model owner.
  ownedTasks(lifetime(), { x: { policy: 'drop', result: 'saved', run: () => Effect.void } });
}
