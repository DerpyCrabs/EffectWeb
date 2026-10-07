`@effectweb/query` caches server data. You define a query once, then views or controllers read it. Views that ask for the same arguments share one request and one cached result.

```bash
npm install @effectweb/query
```

## Define a query

```ts check
import { Effect } from 'effect';
import { query } from '@effectweb/query';

type User = { readonly id: string; readonly name: string };
declare const users: { get: (id: string) => Effect.Effect<User, Error> }; // @hide

export const userQuery = query({
  name: 'user',
  staleTime: 30_000,
  load: (args: { readonly id: string }) => users.get(args.id),
});
```

The cache key is the query's name plus **all** of its arguments. There is no separate key to keep in sync, so you cannot forget a filter or a page size (EW2002). Arguments must be plain data: objects, arrays, strings, numbers, booleans. Services such as an API client come from the Effect environment, not from arguments. A query whose `load` takes no arguments is read with `true` as its argument: `querySource(cache, settingsQuery, true)`, `settings.select(true)`.

## Create the cache

Create one cache for the app, or one per signed-in session.

- Outside Effect: `queryCache(Context.make(Api, api))` with the services the loaders need, then `cache.close()` when done.
- Inside an Effect scope: `yield* Effect.acquireRelease(Effect.map(Effect.context<Api>(), (context) => queryCache(context)), (cache) => cache.close())`. It closes with the scope.

When the user signs out, close the session's cache so the next user cannot see the previous user's data.

## Show the result

In a view, `querySource(cache, query, args)` gives a source to observe. Each result is an `AsyncResult`. `available(result)` is the latest successful value, kept while refreshing and after a failed refresh; `resourceError(result)` is an error message or `undefined`; `result.waiting` is true while a request runs. Render them side by side, so old data stays visible next to a loading marker or an error.

```tsx check
import { Effect } from 'effect';
import { available, observe, resourceError, view } from 'effectweb';
import { query, querySource, type QueryCache } from '@effectweb/query';

type User = { readonly id: string; readonly name: string }; // @hide
declare const users: { get: (id: string) => Effect.Effect<User, Error> }; // @hide
declare const cache: QueryCache; // @hide
const userQuery = query({
  name: 'user',
  load: (args: { readonly id: string }) => users.get(args.id),
}); // @hide

export const UserName = view<{ readonly id: string }>((props) =>
  observe(querySource(cache, userQuery, { id: props.id }), (user) => (
    <>
      {user.waiting ? <p>Loading…</p> : null}
      {resourceError(user) ? <p role="alert">Could not load the user.</p> : null}
      {available(user) ? <b>{available(user)!.name}</b> : null}
    </>
  )),
);
```

`available` cannot tell a successful `undefined` from no data; `AsyncResult.value(result)` returns an `Option` that can. For mutually exclusive branches, Effect's `AsyncResult.builder(result)` also works in a view.

## Use a query in a controller

`observeQuery(owner, cache, query, field)` writes the result into one field of a controller's model. Call `select(args)` to choose the arguments.

```ts check
import { Effect } from 'effect';
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner, type Snapshot } from 'effectweb';
import { observeQuery, query, type QueryCache } from '@effectweb/query';

type User = { readonly id: string; readonly name: string }; // @hide
declare const users: { get: (id: string) => Effect.Effect<User, Error> }; // @hide
const userQuery = query({
  name: 'user',
  load: (args: { readonly id: string }) => users.get(args.id),
}); // @hide

export function profileController(cache: QueryCache, id: string) {
  const owner = modelOwner<{ user: AsyncResult.AsyncResult<Snapshot<User>, Error> }>({
    user: AsyncResult.initial(),
  });
  const user = observeQuery(owner, cache, userQuery, 'user');
  user.select({ id });
  return { source: owner.source, refresh: user.refresh, lifetime: owner };
}
```

## Freshness

- `staleTime` is how long loaded data counts as fresh; without it, data never goes stale. When a view or controller starts reading stale data, it is reloaded while the old value stays visible. It is not a polling interval.
- `retention` (on the cache, default 30 seconds) is how long data with no observers is kept.
- `unused: 'retain'` lets a request finish after its last observer leaves; `'cancel'` interrupts it.

## Refresh after a write

After a successful save, mark the affected data stale:

- one entry: `cache.invalidateQuery(userQuery, { id })`;
- a family of queries: create `const userData = queryGroup('user data')` once, list it in each query's `groups`, then call `cache.invalidateGroup(userData)`.

If the server response already contains the new data, write it directly with `cache.setQueryData` or `cache.updateQueryData` instead of reloading.

## Load more pages

```ts check
import { Effect } from 'effect';
import { infiniteQuery } from '@effectweb/query';

type Page = { readonly items: readonly string[]; readonly next: number | undefined };
declare const loadPage: (chatId: string, cursor: number) => Effect.Effect<Page, Error>; // @hide

export const messagesQuery = infiniteQuery({
  name: 'messages',
  initial: 0,
  load: (args: { readonly chatId: string }, cursor: number) => loadPage(args.chatId, cursor),
  next: (page) => page.next,
  maxPages: 10,
});
```

Read it with `querySource` like any query. The result has `pages` and `next`; `next === undefined` means there are no more pages. Call `fetchNextPage(cache, messagesQuery, args)` from an event handler to load the next one, and `retryPage` to retry a failed page. `maxPages` limits how many pages are kept in memory.

Refreshing reloads the pages already loaded. Set `refresh: 'first'` to start again from the first page.

Caches live in memory. Persistence, sharing across tabs and authorization are up to the application.
