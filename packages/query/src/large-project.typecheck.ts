import { Context, Effect } from 'effect';
import { infiniteQuery, infiniteResource } from './infinite-query.js';
import { queryCache } from './cache.js';
import { query, queryGroup } from './query.js';

class Files extends Context.Service<
  Files,
  { load(path: string, offset: number): Effect.Effect<readonly string[], 'offline'> }
>()('TypecheckFiles') {}
const context = Context.make(Files, { load: () => Effect.succeed([]) });
const cache = queryCache(context, { unused: 'cancel', retention: 60_000 });
const group = queryGroup('files');
const listing = infiniteQuery({
  name: 'listing',
  groups: [group],
  initial: 0,
  load: (args: { path: string }, offset: number) =>
    Effect.flatMap(Files, (files) => files.load(args.path, offset)),
  next: (_page, offset) => offset + 1,
});
const observer = infiniteResource(cache, listing);
observer.select({ path: '/' });
// @ts-expect-error The cache must supply the query service environment.
infiniteResource(queryCache(), listing);
// @ts-expect-error Query arguments must retain their declared type.
observer.select({ path: 1 });
const typed = query({
  name: 'file',
  groups: [group],
  load: (args: { path: string }) => Effect.succeed(args.path),
});
cache.invalidateQuery(typed, { path: '/' });
cache.invalidateGroup(group);
// @ts-expect-error Invalidation groups must be declared with queryGroup.
cache.invalidateGroup(Symbol('files'));
