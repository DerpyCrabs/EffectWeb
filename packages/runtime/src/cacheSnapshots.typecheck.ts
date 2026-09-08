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
      previous.names.push('bad');
      return previous.names[0] === next.names[0] ? previous : next;
    },
  });
  const cache = makeQueryCache();
  const atom = cache.query(people, true);
  const cached = available(cache.registry.get(atom));
  // @ts-expect-error Reading a cache atom does not expose mutable success data.
  cached?.names.push('bad');
  Effect.map(cache.prefetch(people, true), (value) => {
    // @ts-expect-error Prefetch and normal reads publish the same immutable data.
    value.names.push('bad');
    return value;
  });
  const resource = queryResource({ cache }, people);
  resource.subscribe((result) => {
    // @ts-expect-error Subscribers receive immutable success values.
    available(result)?.names.push('bad');
  });
  // @ts-expect-error Resource reads retain immutable nested data.
  available(resource.read())?.names.push('bad');
  const owner = modelOwner({ names: ['initial'] });
  observeQuery(owner, cache, people, (result) => {
    const value = available(result);
    if (value) owner.patch(value);
  });
  owner.dispose();
  resource.dispose();
  cache.dispose();
}
