/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context, Effect, Scope } from 'effect';
import { domMount } from './mount.js';
import { makeMount } from './render.js';
import { view } from './dom.js';
import type { Source } from './source.js';
import { component, ownerOf } from './component.js';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { lazyView } from './advanced.js';

class Storage extends Context.Service<Storage, { readonly save: Effect.Effect<void, 'offline'> }>()(
  'ScopedTypecheck/Storage',
) {}
const setup = Effect.gen(function* () {
  // Views take closed Effects: provide the captured services where the work is built.
  const context = yield* Effect.context<Storage>();
  const save = (_event: MouseEvent) =>
    Effect.flatMap(Storage, (service) => service.save).pipe(Effect.provideContext(context));
  const binding = domMount((_element: HTMLButtonElement) =>
    Effect.acquireRelease(Storage, () => Effect.void).pipe(Effect.provideContext(context)),
  );
  return view<number>((count) => (
    <button use={binding} onClick={save}>
      {count}
    </button>
  ));
});
const source: Source<number> = { model: () => 0, subscribe: () => () => {} };
const mounted = makeMount(document.createElement('div'), setup, source);
const requirements: Effect.Effect<unknown, never, Storage | Scope.Scope> = mounted;
// @ts-expect-error Owning the resource scope does not erase the view's service requirements.
const missingService: Effect.Effect<unknown> = Effect.scoped(mounted);
const provided = Effect.scoped(mounted).pipe(Effect.provideService(Storage, { save: Effect.void }));
// @ts-expect-error Direct JSX callbacks cannot erase a required service.
const missingEventService = <button onClick={() => Storage} />;
const dispatched = view<number, 'increment'>((count, send) => (
  <button onClick={() => send('increment')}>{count}</button>
));
// @ts-expect-error A view that dispatches messages requires a dispatcher at the boundary.
const missingDispatch = makeMount(document.createElement('div'), dispatched, source);
void [requirements, missingService, missingEventService, provided, missingDispatch];

// Adapter work scopes belong to the operation; application services remain explicit.
const scopedLoad = () => Effect.acquireRelease(Effect.succeed('value'), () => Effect.void);
const scopedTasks = component(
  { init: () => ({ read: AsyncResult.initial() as AsyncResult.AsyncResult<string, never> }) },
  view((_model, patch) => (
    <button onClick={() => ownerOf(patch).task('read', scopedLoad(), 'replace')} />
  )),
);
const scopedLazy = lazyView(() =>
  Effect.as(
    scopedLoad(),
    view(() => <span />),
  ),
);
const serviceLoad = () => Effect.acquireRelease(Storage, () => Effect.void);
const serviceView = Effect.as(
  serviceLoad(),
  view(() => <span />),
);
// @ts-expect-error A lazy loader cannot require application services; provide them in the Effect.
const missingLazyService = lazyView(() => serviceView);
const missingTaskService = component(
  {
    init: () => ({}),
    // @ts-expect-error Scope ownership does not provide Storage.
    tasks: { read: { policy: 'replace', run: serviceLoad } },
  },
  view(() => null),
);
void [scopedTasks, scopedLazy, missingLazyService, missingTaskService];
