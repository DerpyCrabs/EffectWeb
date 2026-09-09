/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context } from 'effect';
import {
  commandSlot,
  effectCommand,
  errorBoundary,
  localComponent,
  mapTransition,
  program,
  uiRuntime,
  view,
  ViewBinding,
} from './index.js';
import type { Transition } from './program.js';

class Store extends Context.Service<Store, { readonly count: number }>()('Composition/Store') {}
const runtime = uiRuntime(Context.make(Store, { count: 1 }));
const command = effectCommand(commandSlot('store'), () => Store, {
  policy: 'replace',
  onSuccess: (store) => store.count,
  onFailure: () => 0,
});
const transition: Transition<{ rows: { count: number }[] }, number, Store> = {
  model: { rows: [{ count: 0 }] },
  commands: [command],
};
const lifted = mapTransition(transition, {
  model: (model) => {
    // @ts-expect-error The borrowed child snapshot cannot be mutated by its parent mapper.
    model.rows[0]!.count++;
    return { child: model };
  },
  message: (count) => ({ type: 'Count' as const, count }),
});
runtime.program({ initial: lifted.model, update: () => lifted });
program({
  initial: lifted.model,
  // @ts-expect-error Lifting cannot erase the commands' required services.
  update: () => lifted,
});

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
export const Parent = view<{ count: number }, 'Increment'>((model, send) => (
  <ViewBinding view={Safe} model={model} send={send} />
));
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
const Local = localComponent<{ id: string }, { draft: string }>({
  identity: (props) => {
    // @ts-expect-error Entity identity cannot mutate parent inputs.
    props.id = 'changed';
    return props.id;
  },
  init: (props) => ({ draft: props.id }),
  view: view((model) => model.draft),
});
void Local;
