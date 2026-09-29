# @effectweb/query

Cached server data for [EffectWeb](https://github.com/DerpyCrabs/EffectWeb). Queries are Effects identified by all of their arguments, stored in a cache built on Effect's `AtomRegistry`, and observed by views or controllers.

```ts
import { makeQueryCache, observeQuery, query, querySource } from '@effectweb/query';

const user = query({
  name: 'user',
  staleTime: 30_000,
  load: (args: { readonly id: string }) => Users.pipe(Effect.flatMap((users) => users.get(args.id))),
});
const cache = makeQueryCache(uiRuntime(Context.make(Users, users)));

// In a view: equal arguments share one live, cached source.
observe(querySource(cache, user, { id }), (result) => <AsyncContent result={result} … />);

// In a controller: follow a changing selection and publish results into the model.
const selected = observeQuery(owner, cache, user, (result) => owner.patch({ user: result }));
selected.select({ id });
```

- **One kind of query.** `query` for single values and `infiniteQuery` for pages share the same cache, stale times, retention and invalidation. Views read either through `querySource`; `fetchNextPage` and `retryPage` extend an infinite query, and `infiniteResource` does the same for controllers.
- **Identity is every argument.** There is no custom key (lint rule `effectweb/query-key`, EW2002). Services come from the cache's runtime, never from arguments.
- **Cache operations:** `prefetch`, `getQueryData`, `setQueryData`, `updateQueryData`, `invalidateQuery`, `invalidateGroup` (with `queryGroup`), `invalidateWhere`, `cancelQuery`, `removeQuery`, `resetResources`, `batch`, `close`.
- **Results** are `AsyncResult`s of deeply readonly snapshots. `available(result)` and `resourceError(result)` read them; `AsyncContent` from `effectweb` renders them.
- `scopedQueryCache()` creates a cache owned by the surrounding Effect scope.
