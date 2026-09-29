import { Effect } from 'effect';
import { eventEffects, effectEvent } from './effectEvent.js';
import { modelOwner } from './owner.js';
import { program, commandSlot } from './program.js';
import { programDriver } from './testing.js';

export function effectContracts() {
  const source = program({ initial: 0, update: (model: number) => ({ model }) });
  const owner = modelOwner({ count: 0 });
  const driver = programDriver(source);
  const slot = commandSlot('work');
  const lifetime: Effect.Effect<void, AggregateError> = Effect.gen(function* () {
    yield* source.awaitIdle(slot);
    yield* source.awaitStopped();
    yield* driver.awaitSlot(slot);
    yield* driver.run(Effect.void);
    yield* source.close();
    yield* owner.close();
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
