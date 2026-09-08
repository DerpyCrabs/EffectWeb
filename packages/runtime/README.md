# effectweb

Immutable Effect models and JSX compiled to direct DOM updates, without signals, proxies, or virtual DOM.

Use with `@effectweb/compiler/vite` and Effect `4.0.0-rc.112`. The package includes programs, named tasks, async presentation, query caching, DOM lifetimes, and `effectweb/testing` helpers.

See [setup and example](https://github.com/DerpyCrabs/EffectWeb#vite-setup).

Early API; runtime and compiler versions advance together. Client-side only. Persistence and multi-tab coordination belong to the application.

## Query identity and account ownership

A query definition has its own identity. Within one cache, its key describes every input that can change the loaded result:

```ts
const page = query({
  name: 'message-page',
  key: (args: { accountId: string; threadId: string; cursor?: string }) => [
    args.accountId,
    args.threadId,
    { cursor: args.cursor },
  ],
  load: (args: { accountId: string; threadId: string; cursor?: string }) =>
    api.messages(args.accountId, args.threadId, args.cursor),
});
```

String keys remain supported. Structured keys avoid delimiter collisions and use the same canonical encoding for cache lookup, prefetch, invalidation, and `queryResource.select`. Object property order is ignored; array order matters. Strings, finite numbers, booleans, `null`, and explicit `undefined` are supported recursively in dense arrays and plain objects. Missing properties differ from properties containing `undefined`, and `0` differs from `-0`. Functions, symbols, bigint, nonfinite numbers, cycles, class instances, accessors, nonenumerable properties, sparse arrays, and arrays with extra properties throw `TypeError`. Repeated references to the same plain object are supported. Treat key data and query arguments as immutable; the framework does not clone argument objects.

Include all load-relevant arguments in the key, including account, filters, pagination, locale, and permissions when they affect the result. A callback capturing changing data outside its arguments can reuse an obsolete cache entry. Prefer explicit arguments. Separate query definitions do not share entries even if their names and keys match. `select(undefined)` still disables selection; an explicit `undefined` _inside a structured key_ remains a regular part of its identity.

Give authenticated data an account lifetime:

```ts
const account = modelOwner({ accountId }, { runtime });
const cache = account.own(makeQueryCache(runtime));
const messages = observeQuery(account, cache, page, (result) => {
  // Publish the immutable result into application state.
});
messages.select({ accountId, threadId });

// Sign out or switch account: dispose this lifetime, then create the next one.
account.dispose();
```

Independent caches isolate account data even when services derive authentication from their environment. If an application deliberately reuses a cache across accounts, include account identity in every authenticated query key and call `cache.resetResources()` at the boundary before selecting the new account. Reset interrupts old resources and returns existing query observers to their initial state; select again to enter the new generation. Disposing only a query observer releases its subscription; it does not erase shared cached values. Own shared caches at the account or application scope, not in individual views.

## Write concurrency

`modelOwner.run(slot, effect, policy)` and `defineTasks(owner, definitions)` support these policies:

| Policy          | Behavior for an occupied slot                                           |
| --------------- | ----------------------------------------------------------------------- |
| `drop`          | Ignore the new request.                                                 |
| `replace`       | Cancel active work and discard pending requests; start the new request. |
| `parallel`      | Start the new request alongside active work.                            |
| `queue`         | Append the request; run it after earlier work finishes.                 |
| `latest-queued` | Keep active work; replace all pending requests with the newest request. |

Component `defineTasks(...).tasks(...)` and `taskComponent` support all except `parallel`, since their single result slot represents serial work. Raw program commands also accept `policy`; omitted policy retains `replace`. Command mapping and runtime service provisioning preserve it. Actions sharing a slot share the same policy decisions and cancellation lifetime. A queued request waits for every active request in that slot if policies are mixed; keep a consistent policy per slot for predictable write behavior.

Use `queue` when each accepted operation matters, such as appending messages. Use `latest-queued` when saving complete document snapshots and only the newest pending snapshot matters:

```ts
const writes = defineTasks(owner, {
  save: { policy: 'latest-queued', run: (document: Readonly<Document>) => storage.save(document) },
});

writes.save(owner.read().document);
```

Component tasks capture the model snapshot and input when `Run` is submitted, including requests that wait in a queue. Editing fields afterward does not replace that captured model. Controller tasks retain their supplied arguments; their factories execute when work starts. Pass `owner.read()` data as arguments to capture submission state, or read inside the Effect when execution-time state is intended. Effects and inputs are retained, not deep-cloned; keep supplied data immutable. Dropped and coalesced pending factories are never invoked.

Queue progress continues after successes, typed failures, or defects. Component results remain `waiting` while more work is pending, publish each settlement, and retain the latest successful value if a later write fails. Action failures use the owner's error reporter. `cancel`, component reset or identity change, and disposal discard pending requests and interrupt active work; stale command completions cannot publish afterward. `awaitIdle` includes pending work. Cancellation cannot undo an external write that already completed. Transactions admit their whole command batch before starting Effects, so replacements and cancellation can remove superseded work without executing it.

## Inspect source dependencies

Mount a development panel before mounting the application so it sees initial evaluations:

```ts
import { mountBindingInspector } from 'effectweb/diagnostics';

const removeInspector = mountBindingInspector(document.querySelector<HTMLElement>('#inspector')!);
// Mount the application here. On teardown or HMR:
// removeInspector();
```

The live, filterable table shows original file/line/column, source expressions, inferred snapshot dependencies, the latest changed dependency names, and derive/binding evaluation counts. It uses development compiler metadata; production builds emit none. Counts include initial evaluations, aggregate instances of the same source expression, and measure evaluations rather than actual DOM writes. Change reasons use reference/value equality, without retaining previous or next values.

For custom tooling, `inspectBindings({ limit: 200 })` returns `entries()`, `subscribe(listener)`, `clear()`, and `dispose()`. Entries are immutable metadata, newest first, with at most 1000 source records. Least recently updated sources are evicted and start fresh if seen again. `dispose()` unsubscribes and clears retained metadata. `mountBindingInspector(element, inspector)` can share an inspector; removing that panel leaves the supplied inspector running. Low-level `observeBindings` remains available.

The inspector covers instrumented derivations and text/attribute bindings; it is not a snapshot recorder, time-travel debugger, or complete profile of branch/list reconciliation. Source labels describe the compiler's inferred dependencies, not a proof that an opaque helper has no hidden state.
