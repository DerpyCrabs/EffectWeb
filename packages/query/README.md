# @effectweb/query

Cached server data for [EffectWeb](https://github.com/DerpyCrabs/EffectWeb). Queries are Effects identified by all of their arguments, stored in a shared cache, and observed by views or controllers.

```ts
import { queryCache, observeQuery, query, querySource } from '@effectweb/query';

const user = query({
  name: 'user',
  staleTime: 30_000,
  load: (args: { readonly id: string }) => Users.pipe(Effect.flatMap((users) => users.get(args.id))),
});
const cache = queryCache(Context.make(Users, users));

// In a view: equal arguments share one live, cached source.
observe(querySource(cache, user, { id }), (result) => <b>{available(result)?.name ?? resourceError(result)}</b>);

// In a controller: follow a changing selection and publish results into the model.
const selected = observeQuery(owner, cache, user, 'user');
selected.select({ id });
```

- **One kind of query.** `query` for single values and `infiniteQuery` for pages share the same cache, stale times, retention and invalidation. Views read either through `querySource`; `fetchNextPage` extends an infinite query, and `infiniteResource` does the same for controllers.
- **Identity is every argument.** There is no custom key; the types reject a `key` field. Services come from the cache's context, never from arguments.
- **Cache operations:** `prefetch`, `getQueryData`, `setQueryData`, `updateQueryData`, `invalidateQuery`, `invalidateGroup` (with `queryGroup`), `cancelQuery`, `resetResources`, `batch`, `close`.
- **Results** are `AsyncResult`s of immutable data. `available(result)`, `resourceError(result)` and `result.waiting` from `effectweb` read them.
- `queryCache(context?, options?)` takes the Effect `Context` its loaders need. Inside an Effect, pass `yield* Effect.context<Services>()` and scope the cache with `Effect.acquireRelease(…, (cache) => cache.close())`.
