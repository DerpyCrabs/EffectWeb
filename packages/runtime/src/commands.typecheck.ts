/* oxlint-disable effecttsgo/missing-effect-error -- Negative contract: an unhandled failure is rejected. */
import { Effect } from 'effect';
import type { Command } from './program.js';
import { modelOwner } from './owner.js';

type Message = { readonly type: 'Saved' } | { readonly type: 'Failed' };
declare const save: Effect.Effect<number, 'offline'>;

export function commandTypes() {
  const key = 'save';
  const owner = modelOwner({});
  owner.run(key, Effect.void, 'queue');
  // @ts-expect-error Writes must choose a policy explicitly.
  owner.run(key, Effect.void);
  // @ts-expect-error Keys cannot be symbols.
  owner.run(Symbol('save'), Effect.void, 'queue');
  // @ts-expect-error Raw command declarations must choose a policy.
  const missing: Command<void> = { key, effect: Effect.void };
  // A command's success is its message; Effect.matchCause turns every outcome into one.
  const replied: Command<Message> = {
    key,
    policy: 'drop',
    effect: save.pipe(
      Effect.matchCause({
        onSuccess: (): Message => ({ type: 'Saved' }),
        onFailure: (): Message => ({ type: 'Failed' }),
      }),
    ),
  };
  // An Effect that succeeds with nothing sends no message.
  const silent: Command<Message> = { key, policy: 'replace', effect: Effect.sync(() => {}) };
  // @ts-expect-error A command must handle its failures (or Effect.orDie to report them).
  const unhandled: Command<Message> = { key, policy: 'drop', effect: Effect.asVoid(save) };
  // @ts-expect-error A command's success must be a message or nothing.
  const notMessage: Command<Message> = { key, policy: 'drop', effect: Effect.succeed(42) };
  // @ts-expect-error Owner actions are internal; commands carry an `effect` or a `stream`.
  const action: Command<Message> = { key, policy: 'drop', action: Effect.void };
  void [missing, replied, silent, unhandled, notMessage, action];
  owner.dispose();
}
