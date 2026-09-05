import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { defineActions, type ActionMessage } from './actions.js';
import { effectCommand, program } from './program.js';

it('infers messages and dispatches actions through the real command/message queue', async () => {
  type Model = { value: number; label: string };
  const actions = defineActions<Model>()({
    Increment: (model, by: number) => ({ model: { ...model, value: model.value + by } }),
    Label: (model, label: string = 'default') => ({ model: { ...model, label } }),
    Reset: (model) => ({ model: { ...model, value: 0 } }),
    Load: (model) => ({
      model,
      commands: [
        effectCommand('load', () => Effect.succeed(4), {
          onSuccess: (by) => ({ type: 'Increment' as const, args: [by] as [number] }),
          onFailure: () => ({ type: 'Reset' as const, args: [] as [] }),
        }),
      ],
    }),
  });
  const source = program<Model, ActionMessage<typeof actions>>({
    initial: { value: 0, label: '' },
    update: actions.update,
  });
  const send = actions.bind(source.send);
  send.Increment(2);
  send.Label();
  expect(source.model()).toEqual({ value: 2, label: 'default' });
  source.send(actions.message.Increment(3));
  send.Load();
  await expect.poll(() => source.model().value).toBe(9);
  send.Reset();
  expect(source.model().value).toBe(0);
  source.dispose();
});
