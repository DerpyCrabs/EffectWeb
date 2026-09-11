/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context, Effect, Scope } from 'effect';
import { makeDomBinding, makeDomMount } from './mount.js';
import { makeEffectHandler } from './effectEvent.js';
import { mount } from './render.js';
import { view } from './dom.js';
import { fromStream, type Source } from './source.js';
import * as Stream from 'effect/Stream';
import { defineTasks } from './tasks.js';
import { resourceComponent } from './resource.js';
import { lazyView, modelOwner, keyedTasks } from './index.js';

class Storage extends Context.Service<Storage, { readonly save: Effect.Effect<void, 'offline'> }>()(
  'ScopedTypecheck/Storage',
) {}
const setup = Effect.gen(function* () {
  const save = yield* makeEffectHandler((_event: MouseEvent) =>
    Effect.flatMap(Storage, (service) => service.save),
  );
  const binding = yield* makeDomMount((_element: HTMLButtonElement) =>
    Effect.acquireRelease(Storage, () => Effect.void),
  );
  return view<number>((count) => (
    <button use={binding} onClick={save}>
      {count}
    </button>
  ));
});
const source: Source<number> = { model: () => 0, subscribe: () => () => {} };
const mounted = mount(document.createElement('div'), setup, source);
const requirements: Effect.Effect<unknown, never, Storage | Scope.Scope> = mounted;
// @ts-expect-error Owning the resource scope does not erase the view's service requirements.
const missingService: Effect.Effect<unknown> = Effect.scoped(mounted);
const provided = Effect.scoped(mounted).pipe(Effect.provideService(Storage, { save: Effect.void }));
// @ts-expect-error Direct JSX callbacks cannot erase a required service.
const missingEventService = <button onClick={() => Storage} />;
const binding = makeDomBinding((_element: HTMLInputElement, _input: () => string) => Storage);
const bindingRequirements: Effect.Effect<unknown, never, Storage> = binding;
// @ts-expect-error Erroring streams need an explicit error-as-value policy before observation.
const failedStream = fromStream(Stream.fail('offline'), 0);
const dispatched = view<number, 'increment'>((count, send) => (
  <button onClick={() => send('increment')}>{count}</button>
));
// @ts-expect-error A view that dispatches messages requires a dispatcher at the boundary.
const missingDispatch = mount(document.createElement('div'), dispatched, source);
void [
  requirements,
  missingService,
  missingEventService,
  bindingRequirements,
  provided,
  failedStream,
  missingDispatch,
];

// Adapter work scopes belong to the operation; application services remain explicit.
const scopedLoad = () => Effect.acquireRelease(Effect.succeed('value'), () => Effect.void);
const scopedTasks = defineTasks({ init: () => ({}) }).tasks({
  read: { policy: 'replace', run: scopedLoad },
});
const scopedResource = resourceComponent({
  request: () => ({ key: 'read', load: scopedLoad }),
  view: view(() => <span />),
});
const scopedLazy = lazyView(() =>
  Effect.as(
    scopedLoad(),
    view(() => <span />),
  ),
);
const serviceLoad = () => Effect.acquireRelease(Storage, () => Effect.void);
// @ts-expect-error A work scope cannot provide application services.
const missingResourceService = resourceComponent({
  request: () => ({ key: 'read', load: serviceLoad }),
  view: view(() => <span />),
});
// @ts-expect-error A lazy loader's application service requires an explicit runtime.
const missingLazyService = lazyView(() =>
  Effect.as(
    serviceLoad(),
    view(() => <span />),
  ),
);
const missingTaskService = defineTasks({ init: () => ({}) }).tasks({
  // @ts-expect-error Scope ownership does not provide Storage.
  read: { policy: 'replace', run: serviceLoad },
});
void [
  scopedTasks,
  scopedResource,
  scopedLazy,
  missingResourceService,
  missingLazyService,
  missingTaskService,
];
const keyedOwner = modelOwner({});
const scopedKeyed = keyedTasks(keyedOwner, { name: 'scoped', policy: 'replace', run: scopedLoad });
// @ts-expect-error Keyed tasks also retain application service requirements.
const missingKeyedService = keyedTasks(keyedOwner, {
  name: 'missing',
  policy: 'replace',
  run: serviceLoad,
});
void [scopedKeyed, missingKeyedService];
