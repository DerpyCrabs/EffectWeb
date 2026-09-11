import { Effect } from 'effect';
import { it, expect } from 'vitest';
import { makeQueryCache } from './cache.js';
import { query } from './query.js';
import { queryResource, type QueryResource } from './session.js';

it('select remains coherent if releasing previous query reenters selection', async () => {
  const cache = makeQueryCache({ unused: 'cancel' });
  let resource: QueryResource<string, string>;
  const definition = query({
    name: 'reentrant-selection-release',
    load: (args: string) =>
      args === 'a'
        ? Effect.acquireRelease(Effect.void, () => Effect.sync(() => resource.select('c'))).pipe(
            Effect.andThen(Effect.never),
          )
        : Effect.succeed(args),
  });
  resource = queryResource({ cache }, definition);
  try {
    resource.select('a');
    resource.select('b');
    // Nested selection wins the first race, but the second explicit B must take effect.
    resource.select('b');
    expect(resource.read()).toMatchObject({ _tag: 'Success', value: 'b' });
  } finally {
    resource.dispose();
    await Effect.runPromise(cache.close());
  }
});
