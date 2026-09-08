import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { makeQueryCache } from './cache.js';
import { query } from './query.js';
import { available } from './resource.js';
import { queryResource } from './session.js';

vi.mock('./snapshot.js', async (original) => ({
  ...(await original<typeof import('./snapshot.js')>()),
  checkSnapshotsByDefault: true,
}));

it('protects cached data before an observer or retained loader reference can mutate it', async () => {
  const loaded = { names: ['Ada'] };
  const definition = query({ name: 'people', load: () => Effect.succeed(loaded) });
  const cache = makeQueryCache();
  const source = queryResource({ cache }, definition);
  const seen: string[] = [];
  source.subscribe((result) => {
    const value = available(result);
    if (value) {
      expect(() => {
        // @ts-expect-error Development checks also guard untyped consumer code.
        value.names.push('observer mutation');
      }).toThrow(TypeError);
      seen.push(value.names[0]!);
    }
  });
  try {
    source.select(true);
    const prefetched = await Effect.runPromise(cache.prefetch(definition, true));
    expect(() => loaded.names.push('retained mutation')).toThrow(TypeError);
    expect(prefetched).toBe(available(source.read()));
    expect(prefetched.names).toEqual(['Ada']);
    expect(seen).toEqual(['Ada']);
  } finally {
    source.dispose();
    cache.dispose();
  }
});
