import { Effect } from 'effect';
import { eventEffects } from './event-effects.js';
import { modelOwner } from './owner.js';
import { program } from './program.js';

export function effectContracts() {
  const source = program({ initial: 0, update: (model: number) => ({ model }) });
  const owner = modelOwner({ count: 0 });
  const key = 'work';
  const lifetime: Effect.Effect<void> = Effect.gen(function* () {
    yield* source.awaitIdle(key);
    yield* source.close();
    yield* owner.close();
  });
  // @ts-expect-error Owners require Effect closure, preserving cancellation and error types.
  owner.own({ dispose() {}, close: async () => {} });
  const acceptPromise = (_value: Promise<void>) => {};
  // @ts-expect-error Core lifecycle APIs do not return Promises.
  acceptPromise(owner.close());
  const requests = eventEffects(() => {});
  requests.accept(Effect.void);
  // @ts-expect-error Only an Effect can enter event execution.
  requests.accept(Promise.resolve());
  void lifetime;
}
