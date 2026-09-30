/* oxlint-disable effecttsgo/missing-effect-context -- Negative service-requirement type contracts. */
import { Context, Effect, Scope } from 'effect';
import { domMount } from './mount.js';
import { effectEvent } from './effectEvent.js';
import { mount } from './render.js';
import { view } from './dom.js';
import { uiRuntime } from './runtime.js';
import type { Source } from './source.js';
import { defineTasks } from './tasks.js';
import { lazyView } from './advanced.js';

class Storage extends Context.Service<Storage, { readonly save: Effect.Effect<void, 'offline'> }>()(
  'ScopedTypecheck/Storage',
) {}
const setup = Effect.gen(function* () {
  const runtime = uiRuntime(yield* Effect.context<Storage>());
  const save = effectEvent(
    'drop',
    (_event: MouseEvent) => Effect.flatMap(Storage, (service) => service.save),
    runtime,
  );
  const binding = domMount(
    (_element: HTMLButtonElement) => Effect.acquireRelease(Storage, () => Effect.void),
    runtime,
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
const dispatched = view<number, 'increment'>((count, send) => (
  <button onClick={() => send('increment')}>{count}</button>
));
// @ts-expect-error A view that dispatches messages requires a dispatcher at the boundary.
const missingDispatch = mount(document.createElement('div'), dispatched, source);
void [requirements, missingService, missingEventService, provided, missingDispatch];

// Adapter work scopes belong to the operation; application services remain explicit.
const scopedLoad = () => Effect.acquireRelease(Effect.succeed('value'), () => Effect.void);
const scopedTasks = defineTasks({ init: () => ({}) }).tasks({
  read: { policy: 'replace', run: scopedLoad },
});
const scopedLazy = lazyView(() =>
  Effect.as(
    scopedLoad(),
    view(() => <span />),
  ),
);
const serviceLoad = () => Effect.acquireRelease(Storage, () => Effect.void);
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
void [scopedTasks, scopedLazy, missingLazyService, missingTaskService];
