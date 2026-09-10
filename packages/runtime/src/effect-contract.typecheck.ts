import { Effect } from 'effect';
import { eventEffects, effectEvent } from './effectEvent.js';
import { keyedTasks, type TaskOutcome } from './keyed-tasks.js';
import { modelOwner } from './owner.js';
import { program, commandSlot } from './program.js';
import { makeQueryCache } from './cache.js';
import { programDriver } from './testing.js';

export function effectContracts() {
  const source = program({ initial: 0, update: (model: number) => ({ model }) });
  const owner = modelOwner({ count: 0 });
  const cache = makeQueryCache();
  const driver = programDriver(source);
  const slot = commandSlot('work');
  const tasks = keyedTasks(owner, {
    name: 'save',
    policy: 'queue',
    run: (_key: string, input: number) => Effect.succeed(input),
  });
  const outcome: Effect.Effect<TaskOutcome<number, never>> = tasks.submit('id', 1).outcome;
  const lifetime: Effect.Effect<void, AggregateError> = Effect.gen(function* () {
    yield* source.awaitIdle(slot);
    yield* source.awaitStopped();
    yield* driver.awaitSlot(slot);
    yield* driver.run(Effect.void);
    yield* tasks.drain('id');
    yield* outcome;
    yield* source.close();
    yield* owner.close();
    yield* cache.close();
  });
  // @ts-expect-error Owners require Effect closure, preserving cancellation and error types.
  owner.own({ dispose() {}, close: async () => {} });
  const acceptPromise = (_value: Promise<void>) => {};
  // @ts-expect-error Core lifecycle APIs do not return Promises.
  acceptPromise(owner.close());
  const requests = eventEffects(() => {});
  requests.accept(effectEvent('replace', () => Effect.void)(new Event('click')));
  // @ts-expect-error Only an owned request can enter event execution.
  requests.accept(Promise.resolve());
  void lifetime;
}
