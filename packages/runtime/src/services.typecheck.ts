/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context, Effect } from 'effect';
import * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { defineTasks } from './tasks.js';
import { uiRuntime } from './runtime.js';
import { effectCommand, program } from './program.js';
import { view } from './dom.js';

class Storage extends Context.Service<
  Storage,
  { save: (text: string) => Effect.Effect<number, 'offline'> }
>()('Typecheck/Storage') {}
class Missing extends Context.Service<Missing, { value: number }>()('Typecheck/Missing') {}
const runtime = uiRuntime(Context.make(Storage, { save: () => Effect.succeed(1) }));
const definition = defineTasks({
  init: (props: { id: string }) => ({ text: props.id }),
  runtime,
}).tasks({
  save: {
    policy: 'drop',
    run: (model, suffix: string) =>
      Effect.flatMap(Storage, (storage) => storage.save(model.text + suffix)),
  },
});
// The imported view marker remains a separate staged argument; no result annotations are needed.
definition.view(
  view((model, send) => {
    const result: AsyncResult.AsyncResult<number, 'offline'> = model.tasks.save;
    const controls = definition.controls(send);
    controls.run('save', 'suffix');
    // @ts-expect-error task inputs remain inferred
    controls.run('save', 3);
    // @ts-expect-error task names remain inferred
    controls.cancel('missing');
    // @ts-expect-error private completion events are not exposed
    send({ type: 'Settled', task: 'save', result });
    return result as never;
  }),
);
// @ts-expect-error missing service cannot be supplied by an unrelated runtime
const rejected = runtime.provide(Missing);
void rejected;
defineTasks({ init: () => ({ text: '' }) }).tasks({
  // @ts-expect-error JSX cannot erase this requirement: rejected before a view exists
  save: { policy: 'drop', run: () => Storage },
});
const command = effectCommand('save', () => Storage, { onSuccess: () => 1, onFailure: () => 0 });
program({
  initial: 0,
  update: () => ({
    model: 0,
    // @ts-expect-error raw programs only accept closed effects
    commands: [command],
  }),
});
runtime.program({ initial: 0, update: () => ({ model: 0, commands: [command] }) });

const extractedConfig = { init: (props: { id: string }) => ({ text: props.id }), runtime };
defineTasks(extractedConfig).tasks({
  save: {
    policy: 'drop',
    run: (model) => Effect.flatMap(Storage, (storage) => storage.save(model.text)),
  },
});

// Every renderer boundary either requires closed Effects or an explicitly supplied runtime.
import { resourceComponent } from './resource.js';
import { component } from './component.js';
import { compiled } from './dom.js';
import { effectEvent } from './effectEvent.js';
import { domMount, domBinding } from './mount.js';
// @ts-expect-error services must be supplied before resource views are created
resourceComponent({
  request: (_props: void) => ({ key: 'storage', load: () => Storage }),
  view: compiled(() => {}),
});
resourceComponent({
  runtime,
  request: (_props: void) => ({ key: 'storage', load: () => Storage }),
  view: compiled(() => {}),
});
// @ts-expect-error services must be supplied before stateful views are created
component({
  init: (_props: void) => ({ props: undefined }),
  update: (model) => ({ model, commands: [command] }),
  view: compiled(() => {}),
});
component({
  runtime,
  init: (_props: void) => ({ props: undefined }),
  update: (model) => ({ model, commands: [command] }),
  view: compiled(() => {}),
});
// @ts-expect-error native event ownership does not erase service requirements
effectEvent('drop', (_event: Event) => Storage);
effectEvent('drop', (_event: Event) => Storage, runtime);
const lifetime = Effect.flatMap(Storage, () => Effect.never);
// @ts-expect-error DOM lifetime requirements need a runtime
domMount((_element: HTMLElement) => lifetime);
domMount((_element: HTMLElement) => lifetime, runtime);
// @ts-expect-error DOM binding requirements need a runtime
domBinding('input', (_element: HTMLElement, _input: () => string) => lifetime);
domBinding('input', (_element: HTMLElement, _input: () => string) => lifetime, runtime);

import { modelOwner } from './owner.js';
import { makeQueryCache } from './cache.js';
import { query } from './query.js';
import { observeQuery } from './session.js';
const ownedModel = modelOwner({ count: 0 }, { runtime });
ownedModel.run(
  'save',
  Effect.flatMap(Storage, (storage) => storage.save('text')),
);
// @ts-expect-error Required services must be provided by the owner's runtime.
modelOwner({ count: 0 }).run('save', Storage);
// @ts-expect-error An unrelated service cannot run in this owner.
ownedModel.run('missing', Missing);
const ownedCache = ownedModel.own(makeQueryCache(runtime));
const ownedQuery = query({
  name: 'save-result',
  load: () => Effect.flatMap(Storage, (storage) => storage.save('text')),
});
observeQuery(ownedModel, ownedCache, ownedQuery, (result) => {
  const typed: AsyncResult.AsyncResult<number, 'offline'> = result;
  void typed;
});
// @ts-expect-error Query observation preserves service requirements.
observeQuery(ownedModel, makeQueryCache(), ownedQuery, () => {});
