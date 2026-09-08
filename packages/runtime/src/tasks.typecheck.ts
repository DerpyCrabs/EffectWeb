import { Effect } from 'effect';
import { defineTasks } from './tasks.js';

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
