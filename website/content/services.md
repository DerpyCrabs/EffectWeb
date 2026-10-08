An app starts by mounting a view into an element. `mount(parent, App, source)` is enough while nothing needs Effect services, as in [Getting started](/docs/getting-started/#3-write-the-app). Once Effects need services, run the app as an Effect and mount it with `makeMount`.

## Mount the app

```tsx check
import { Effect } from 'effect';
import { makeMount, modelOwner, view } from 'effectweb';

const App = view<{ readonly count: number }>((model) => <p>{model.count}</p>); // @hide

const main = Effect.gen(function* () {
  const owner = modelOwner({ count: 0 });
  yield* makeMount(document.getElementById('app')!, App, owner.source, {
    onError: (error) => console.error(error),
  });
  return yield* Effect.never;
});

Effect.runFork(Effect.scoped(main));
```

`makeMount` returns an Effect, so it does nothing until it runs inside your app's Effect: write `yield* makeMount(…)`. Calling it as a plain statement mounts nothing and reports no error; outside an Effect, use `mount`. It gives Effects started by views the services of the Effect it runs in, and removes the view when the scope closes. `Effect.never` keeps that scope, and any services built for it, open for as long as the page is. Vite reloads the page when the entry module changes, so the entry needs no hot-reload cleanup.

Both take the same third argument: a source such as `owner.source` or a program, or fixed props such as `{}` for a root that takes none, such as a [`controllerView`](/docs/controllers/#create-a-controller-from-a-view). Neither disposes a source. `mount(parent, App, input)` returns a handle; call its `dispose()` to remove the view.

## Provide services

Effects in tasks and queries often need services, such as an API client. Services are an Effect `Context`: build one with `Context.make(Api, api)`, or capture the current one inside an Effect with `yield* Effect.context<Api>()`.

Pass the context to whatever runs Effects that need those services: `modelOwner(initial, { context })`, `program({ context, … })`, the `context` option of a component with `update`, or `queryCache(context)`. Do not pass services through props or query arguments.

Effects started by views, such as one returned from a click handler, run with the services `makeMount` was called with, but their type cannot require a service. Provide it where the Effect is built (`Effect.provideContext`), or call a controller method instead.

## Catch rendering errors

`errorBoundary` wraps a view. If it throws while rendering, the fallback is shown instead and the rest of the page keeps working.

```tsx check
import { errorBoundary, view } from 'effectweb';

const Profile = view<{ readonly name: string }>((props) => <p>{props.name}</p>); // @hide

export const SafeProfile = errorBoundary(Profile, {
  fallback: view(() => <p role="alert">This section could not be displayed.</p>),
});
```

Request failures are not rendering errors. Show them with [`resourceError`](/docs/queries/#show-the-result).

Other errors go to the `onError` option of `mount` or `makeMount`. Without it they are only logged to the console. An error during the first render is thrown from `mount` itself. In development, error messages include the binding and source location that failed, such as `in {model.rows} (App.tsx:7:12)`.

## Two copies of the runtime

If two copies of `effectweb` are loaded, for example from two installs or a linked package, rendering fails with a message that names the second copy. Make sure only one is installed. The Vite plugin already deduplicates linked packages.
