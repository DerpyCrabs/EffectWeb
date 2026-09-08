import { commandSlot } from './program.js';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { defineActions, type ActionMessage } from './actions.js';
import { effectCommand, program } from './program.js';

const commandLoad = commandSlot('load');

it('infers messages and dispatches actions through the real command/message queue', async () => {
  type Model = { value: number; label: string };
  const actions = defineActions<Model>()({
    Increment: (model, by: number) => ({ model: { ...model, value: model.value + by } }),
    Label: (model, label: string = 'default') => ({ model: { ...model, label } }),
    Reset: (model) => ({ model: { ...model, value: 0 } }),
    Load: (model) => ({
      model,
      commands: [
        effectCommand(commandLoad, () => Effect.succeed(4), {
          policy: 'replace',
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

it('carries declared services through actions to their owning runtime', async () => {
  const { Context } = await import('effect');
  const { uiRuntime } = await import('./runtime.js');
  interface Api {
    readonly value: number;
  }
  const Api = Context.Service<Api>('actions-test/Api');
  interface Other {
    readonly unrelated: true;
  }
  const Other = Context.Service<Other>('actions-test/Other');
  type Model = { value: number };
  const actions = defineActions<Model, Api>()({
    Loaded: (_model, value: number) => ({ model: { value } }),
    Load: (model) => ({
      model,
      commands: [
        effectCommand(commandLoad, () => Api, {
          policy: 'replace',
          onSuccess: ({ value }) => ({ type: 'Loaded' as const, args: [value] as [number] }),
          onFailure: () => ({ type: 'Loaded' as const, args: [0] as [number] }),
        }),
      ],
    }),
  });
  const source = uiRuntime(Context.make(Api, { value: 42 })).program<
    Model,
    ActionMessage<typeof actions>
  >({ initial: { value: 0 }, update: actions.update });
  actions.bind(source.send).Load();
  await source.awaitIdle();
  expect(source.model().value).toBe(42);
  source.dispose();
  const typingOnly = () => {
    // @ts-expect-error The action reducer still requires its declared service.
    // oxlint-disable-next-line effecttsgo/missing-effect-context -- Negative type probe deliberately omits the required service and is never executed.
    program({ initial: { value: 0 }, update: actions.update });
    uiRuntime(Context.make(Other, { unrelated: true })).program<
      Model,
      ActionMessage<typeof actions>
    >({
      initial: { value: 0 },
      // @ts-expect-error An unrelated runtime cannot discharge the action requirement.
      // oxlint-disable-next-line effecttsgo/missing-effect-context -- Negative type probe supplies an unrelated service and is never executed.
      update: actions.update,
    });
    // @ts-expect-error Payload inference survives service propagation.
    actions.message.Loaded('wrong');
  };
  void typingOnly;
});
