import { Context, Effect } from 'effect';
import { infiniteQuery, infiniteResource } from './infinite-query.js';
import { makeQueryCache } from './cache.js';
import { keyedTasks, type TaskHandle } from './keyed-tasks.js';
import { modelOwner } from './owner.js';
import { pages } from './pages.js';
import { query, queryGroup } from './query.js';
import { uiRuntime } from './runtime.js';

class Files extends Context.Service<
  Files,
  { load(path: string, offset: number): Effect.Effect<readonly string[], 'offline'> }
>()('TypecheckFiles') {}
const runtime = uiRuntime(Context.make(Files, { load: () => Effect.succeed([]) }));
const cache = makeQueryCache(runtime, { unused: 'cancel', retention: 60_000 });
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
// @ts-expect-error A cursor must retain its declared type.
const invalidRetry = observer.retryPage('invalid');
void invalidRetry;
// @ts-expect-error The cache must supply the query service environment.
infiniteResource(makeQueryCache(), listing);
// @ts-expect-error Query arguments must retain their declared type.
observer.select({ path: 1 });
const local = pages(
  {
    key: (path: string) => path,
    itemKey: (value: string) => value,
    load: (path: string, offset: number | undefined) =>
      Effect.flatMap(Files, (files) => files.load(path, offset ?? 0)).pipe(
        Effect.map((items) => ({ items, next: undefined as number | undefined })),
      ),
  },
  runtime,
);
local.create('/');
// @ts-expect-error Local pagination must receive its required services.
pages({
  key: (path: string) => path,
  itemKey: (value: string) => value,
  load: (path: string) =>
    Effect.flatMap(Files, (files) => files.load(path, 0)).pipe(
      Effect.map((items) => ({ items, next: undefined })),
    ),
});
const owner = modelOwner({});
const saves = keyedTasks(
  owner,
  {
    name: 'save',
    policy: 'latest-queued',
    run: (_id: string, input: { content: string }) =>
      Effect.flatMap(Files, () =>
        input.content ? Effect.succeed(1) : Effect.fail('empty' as const),
      ),
  },
  runtime,
);
const handle: TaskHandle<number, 'empty'> = saves.submit('document', { content: 'text' });
void handle;
// @ts-expect-error Task input is checked independently from the key.
saves.submit('document', { content: 4 });
// @ts-expect-error Task result retains its declared failure channel.
const wrong: TaskHandle<number, 'other'> = saves.submit('document', { content: 'text' });
void wrong;
const typed = query({
  name: 'file',
  groups: [group],
  load: (args: { path: string }) => Effect.succeed(args.path),
});
cache.invalidateWhere(typed, (args) => args.path.startsWith('/'));
cache.invalidateGroup(group);
// @ts-expect-error Invalidation groups must be declared with queryGroup.
cache.invalidateGroup(Symbol('files'));
cache.invalidateWhere(typed, (args) => {
  // @ts-expect-error Predicates borrow immutable arguments.
  args.path = 'changed';
  return true;
});
