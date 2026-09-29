import { Context, Effect } from 'effect';
import type * as AsyncResult from 'effect/unstable/reactivity/AsyncResult';
import { modelOwner, uiRuntime } from 'effectweb';
import { makeQueryCache } from './cache.js';
import { query } from './query.js';
import { observeQuery } from './observe.js';

class Storage extends Context.Service<
  Storage,
  { save: (text: string) => Effect.Effect<number, 'offline'> }
>()('QueryTypecheckStorage') {}
const runtime = uiRuntime(Context.make(Storage, { save: () => Effect.succeed(1) }));
const ownedModel = modelOwner({ count: 0 }, { runtime });
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
