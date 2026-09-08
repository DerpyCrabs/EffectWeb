import { Effect } from 'effect';
import { makeQueryCache } from './cache.js';
import { query } from './query.js';
import { available } from './resource.js';
import { observeQuery, queryResource } from './session.js';
import { modelOwner } from './owner.js';

export function cachedSnapshotTypes() {
  const people = query({
    name: 'people',
    load: () => Effect.succeed({ names: ['Ada'] }),
    share: (previous, next) => {
      // @ts-expect-error Sharing may reuse previous data but cannot change it.
      // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
      previous.names.push('bad');
      // @ts-expect-error Sharing also accepts borrowed readonly data from cache writes.
      // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
      next.names.push('bad');
      return previous.names[0] === next.names[0] ? previous : next;
    },
  });
  const cache = makeQueryCache();
  // @ts-expect-error String-key resources cannot establish shared result types.
  // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
  cache.resource('people', () => Effect.succeed(1));
  // @ts-expect-error Application caches do not expose registry mutation.
  void cache.registry;
  // @ts-expect-error Application caches do not expose generation mutation.
  void cache.generation;
  const fetched = Effect.map(cache.prefetch(people, true), (value) => {
    // @ts-expect-error Prefetch and normal reads publish the same immutable data.
    // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
    value.names.push('bad');
    return value;
  });
  const resource = queryResource({ cache }, people);
  resource.subscribe((result) => {
    // @ts-expect-error Subscribers receive immutable success values.
    // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
    available(result)?.names.push('bad');
  });
  // @ts-expect-error Resource reads retain immutable nested data.
  // oxlint-disable-next-line typescript/no-unsafe-call -- Negative type contract deliberately calls a member rejected by TypeScript.
  available(resource.read())?.names.push('bad');
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
