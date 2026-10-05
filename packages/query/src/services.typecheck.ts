import { Context, Effect } from 'effect';
import type * as AsyncResult from 'effect/reactivity/AsyncResult';
import { modelOwner } from 'effectweb';
import { queryCache } from './cache.js';
import { query } from './query.js';
import { observeQuery } from './observe.js';

class Storage extends Context.Service<
  Storage,
  { save: (text: string) => Effect.Effect<number, 'offline'> }
>()('QueryTypecheckStorage') {}
const context = Context.make(Storage, { save: () => Effect.succeed(1) });
const ownedModel = modelOwner({ count: 0 }, { context });
const ownedCache = ownedModel.own(queryCache(context));
const ownedQuery = query({
  name: 'save-result',
  load: () => Effect.flatMap(Storage, (storage) => storage.save('text')),
});
observeQuery(ownedModel, ownedCache, ownedQuery, (result) => {
  const typed: AsyncResult.AsyncResult<number, 'offline'> = result;
  void typed;
});
// @ts-expect-error Query observation preserves service requirements.
observeQuery(ownedModel, queryCache(), ownedQuery, () => {});
