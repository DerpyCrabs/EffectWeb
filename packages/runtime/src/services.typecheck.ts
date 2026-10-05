/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context, Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { program, type Command } from './program.js';
import { view } from './dom.js';

const commandSave = 'save';
const commandMissing = 'missing';

class Storage extends Context.Service<
  Storage,
  { save: (text: string) => Effect.Effect<number, 'offline'> }
>()('Typecheck/Storage') {}
class Missing extends Context.Service<Missing, { value: number }>()('Typecheck/Missing') {}
const context = Context.make(Storage, { save: () => Effect.succeed(1) });
component(
  {
    init: (props: { id: string }) => ({
      text: props.id,
      saved: AsyncResult.initial() as AsyncResult.AsyncResult<number, 'offline'>,
    }),
  },
  view((model, patch) => {
    const owner = ownerOf(patch);
    // A component owner's work is closed over services: provide them with Effect.
    owner.task(
      'saved',
      Effect.flatMap(Storage, (storage) => storage.save(model.text)).pipe(
        Effect.provideContext(context),
      ),
      'drop',
    );
    owner.task(
      'saved',
      // @ts-expect-error A component task cannot require a service it was not given
      Effect.flatMap(Storage, (storage) => storage.save(model.text)),
      'drop',
    );
    return null;
  }),
);
const command: Command<number, Storage> = {
  key: commandSave,
  policy: 'replace',
  effect: Storage.pipe(Effect.matchCause({ onSuccess: () => 1, onFailure: () => 0 })),
};
// @ts-expect-error a program whose commands require services needs a context
program({ initial: 0, update: () => ({ model: 0, commands: [command] }) });
program({ context, initial: 0, update: () => ({ model: 0, commands: [command] }) });

import { component, ownerOf } from './component.js';
import { compiled } from './dom.js';
import { domMount, domBinding } from './mount.js';
component(
  {
    init: (_props: void) => ({}),
    // @ts-expect-error services must be supplied before stateful views are created
    update: (model) => ({ model, commands: [command] }),
  },
  compiled(() => {}),
);
component(
  { context, init: (_props: void) => ({}), update: (model) => ({ model, commands: [command] }) },
  compiled(() => {}),
);
const lifetime = Effect.flatMap(Storage, () => Effect.never);
// @ts-expect-error DOM lifetimes cannot require services; provide them in the Effect
domMount((_element: HTMLElement) => lifetime);
domMount((_element: HTMLElement) => lifetime.pipe(Effect.provideContext(context)));
// @ts-expect-error DOM bindings cannot require services; provide them in the Effect
domBinding('input', (_element: HTMLElement, _input: () => string) => lifetime);

import { modelOwner } from './owner.js';
const ownedModel = modelOwner({ count: 0 }, { context });
ownedModel.run(
  commandSave,
  Effect.flatMap(Storage, (storage) => storage.save('text')),
  'replace',
);
// @ts-expect-error Required services must be provided by the owner's context.
void modelOwner({ count: 0 }).run(commandSave, Storage, 'replace');
// @ts-expect-error An unrelated service cannot run in this owner.
ownedModel.run(commandMissing, Missing, 'replace');

ownedModel.run(
  commandSave,
  Effect.flatMap(Storage, (storage) => storage.save('text')),
  'drop',
);
const resultOwner = modelOwner(
  { saved: AsyncResult.initial() as AsyncResult.AsyncResult<number, 'offline'> },
  { context },
);
resultOwner.task(
  'saved',
  Effect.flatMap(Storage, (storage) => storage.save('text')),
  'drop',
);
resultOwner.task(
  'saved',
  // @ts-expect-error An unrelated service cannot run in this owner's task.
  Effect.flatMap(Missing, () => Effect.succeed(1)),
  'drop',
);
