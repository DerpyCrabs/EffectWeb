import { Effect } from 'effect';
import { queryCache } from './cache.js';
import { query } from './query.js';
import { available } from 'effectweb';
import { modelOwner } from 'effectweb';
import { observeQuery } from './observe.js';

export function cachedSnapshotTypes() {
  const people = query({
    name: 'people',
    load: () => Effect.succeed({ names: ['Ada'] }),
    share: (previous, next) => (previous.names[0] === next.names[0] ? previous : next),
  });
  const cache = queryCache();
  // @ts-expect-error String-key resources cannot establish shared result types.
  // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
  cache.resource('people', () => Effect.succeed(1));
  // @ts-expect-error Application caches do not expose registry mutation.
  void cache.registry;
  // @ts-expect-error Application caches do not expose generation mutation.
  void cache.generation;
  // Results keep the query's own type.
  const fetched: Effect.Effect<{ names: string[] }, never> = cache.prefetch(people, true);
  const resource = observeQuery(modelOwner({}), cache, people, () => {});
  const owner = modelOwner({ names: ['initial'] });
  observeQuery(owner, cache, people, (result) => {
    const value = available(result);
    if (value) owner.patch(value);
  });
  owner.dispose();
  resource.dispose();
  cache.dispose();
  return fetched;
}
