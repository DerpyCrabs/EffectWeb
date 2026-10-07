import { Effect } from 'effect';
/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context } from 'effect';
import { component, errorBoundary, program, view } from './index.js';
import type { Command, Transition } from './program.js';

class Store extends Context.Service<Store, { readonly count: number }>()('Composition/Store') {}
const context = Context.make(Store, { count: 1 });
const command: Command<number, Store> = {
  key: 'store',
  policy: 'replace',
  effect: Store.pipe(Effect.matchCause({ onSuccess: (store) => store.count, onFailure: () => 0 })),
};
const transition: Transition<{ rows: { count: number }[] }, number, Store> = {
  model: { rows: [{ count: 0 }] },
  commands: [command],
};
program({ context, initial: transition.model, update: () => transition });
// @ts-expect-error A program cannot erase the commands' required services.
program({ initial: transition.model, update: () => transition });

const Child = view<{ count: number }, 'Increment'>((model, send) => (
  <button onClick={() => send('Increment')}>{model.count}</button>
));
const Fallback = view<{ model: { count: number }; error: unknown }, 'Increment'>((model, send) => (
  <button onClick={() => send('Increment')}>{model.model.count}</button>
));
const Safe = errorBoundary(Child, {
  fallback: Fallback,
  reset: (model) => {
    // @ts-expect-error Reset identity borrows the immutable input.
    model.count++;
    return model.count;
  },
});
export const Parent = Safe;
const WrongModel = view<{ model: { text: string }; error: unknown }, 'Increment'>(
  (model) => model.model.text,
);
// @ts-expect-error The content view fixes the fallback model shape.
errorBoundary(Child, { fallback: WrongModel });
const WrongMessage = view<{ model: { count: number }; error: unknown }, 'Delete'>(
  (_model, send) => <button onClick={() => send('Delete')} />,
);
// @ts-expect-error The fallback cannot introduce unsupported messages.
errorBoundary(Child, { fallback: WrongMessage });
const Local = component<{ id: string }, { draft: string }>(
  {
    identity: (props) => {
      // @ts-expect-error Entity identity cannot mutate parent inputs.
      props.id = 'changed';
      return props.id;
    },
    init: (props) => ({ draft: props.id }),
  },
  view((model) => model.draft),
);
void Local;
