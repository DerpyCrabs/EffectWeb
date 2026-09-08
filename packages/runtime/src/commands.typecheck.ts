import { Effect } from 'effect';
import { commandSlot, effectCommand, actionCommand, type Command } from './program.js';
import { modelOwner } from './owner.js';

export function commandTypes() {
  const slot = commandSlot('save');
  const owner = modelOwner({});
  owner.run(slot, Effect.void, 'queue');
  // @ts-expect-error Writes must choose a policy explicitly.
  owner.run(slot, Effect.void);
  // @ts-expect-error Names are diagnostic labels, not operation identity.
  owner.run('save', Effect.void, 'queue');
  // @ts-expect-error Raw command declarations must choose a policy.
  const missing: Command<void> = { slot, effect: Effect.void };
  // @ts-expect-error Effect command factories must choose a policy.
  effectCommand(slot, () => Effect.void, { onSuccess: () => 1, onFailure: () => 0 });
  // @ts-expect-error Action command factories must choose a policy.
  actionCommand(slot, () => Effect.void);
  void missing;
  owner.dispose();
}
