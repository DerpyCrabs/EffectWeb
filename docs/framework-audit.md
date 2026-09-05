# Framework audit across three consumers

Audited on 2026-09-05 against the current TeleVecha, LocalChat and Inbox migrations. Changes are local and unpublished. The applications were tested with local package tarballs; the deployed Inbox assets were not replaced.

## Extraction cleanup

The runtime does not import consumer source or contain Telegram business logic. The extraction did leave misleading comments, compiler branding and implicit import matching:

- The Vite entry is now `effectweb()` from `@effectweb/compiler/vite`, available as a named or default export. Direct compilation is `compile()` with `CompilerOptions`, `CompilerResult` and `Diagnostic`.
- The query cache is `makeQueryCache()` / `QueryCache`, including the `effectweb/cache` entry point.
- The old compiler/cache aliases are removed. All three consumers use the canonical names.
- Compiler source, native binary names, generated identifiers and error messages use EffectWeb names. Release staging and the native loader use the same binary name.
- An unrelated module ending in `/mvu` is no longer silently claimed by the compiler. Custom wrappers must explicitly configure `importSource` and, where needed, `runtimeModule`.
- Generic documentation no longer assumes Telegram adapters, deletion dialogs, GIF search or account-specific storage. Copyright attribution and the README's historical credit remain intact.

“Snapshot” remains the name of the immutable value the renderer observes. That describes its model rather than an application dependency.

## Authoring improvements supported by the migrations

### Collections

LocalChat and Inbox independently recreated an `entities` helper. Both allocated a new collection cache for each call. The runtime now supplies `entities(items)`, using domain `id` fields and retaining a stable wrapper for the same immutable array. `undefined` represents an empty collection while a result is unavailable. Both applications use it directly.

Custom identities remain explicit: LocalChat's optimistic message render keys and composite skill-file identities are still application-owned. Arrays whose duplicate values matter use positional `sequence` rows.

### Async refresh

Inbox needed a guard around `queryResource.refresh()` to prevent polling from canceling a slow request indefinitely. Refresh now coalesces with a pending request, including when another observer owns the same query. It can revalidate again after settlement. A refresh on a resource from a reset cache generation does nothing.

Explicit cache invalidation retains its cancellation semantics: a mutation may make an older request obsolete. Refresh and invalidation serve different purposes.

### Pure views and events

A pure view can omit `send`, and its message type defaults to `never`:

```tsx
const Title = view<{ title: string }>((model) => <h1>{model.title}</h1>);
```

Inline `onX` callbacks can read browser APIs and assign properties of the native event's `currentTarget` or `target`. This supports input resets and deferred focus without moving a few synchronous lines into an adapter. Model assignments and browser reads during rendering remain rejected; async application work still needs an owner.

Custom callback props such as `confirm={() => service.delete(id)}` remain supported. Compiler tests distinguish these callbacks from immediately executed render derivations. A browser regression checks the latest model value, input clearing and deferred focus together.

## Bundle evidence

The compiler now marks compiled view and static-template construction as pure. Those constructors allocate definitions; they do not build DOM until mounted. This lets the bundler discard unused views, their hoisted templates and the runtime functions reachable only from those views.

Production fixture, gzip bytes:

| Fixture                                | Before |        After |
| -------------------------------------- | -----: | -----------: |
| Static text view                       |  2,098 |        2,100 |
| Same view plus an unused eventful view | 11,763 |        2,104 |
| Program with Effect reactivity         | 28,092 | about 28,092 |
| Query cache with Effect reactivity     | 28,174 | about 28,174 |

The small view figure is a renderer subset, not the entire framework. Programs and queries retain Effect's execution and Atom machinery. Replacing `Atom.make` with an explicit writable atom, and adding a pure annotation to the default runtime factory, produced no meaningful reduction; neither experiment was retained.

The three existing apps already use nearly all their views. Summed gzip bytes across their JavaScript chunks, using Node's default gzip level:

| App       |  Before |   After |
| --------- | ------: | ------: |
| TeleVecha | 422,025 | 422,032 |
| LocalChat | 100,192 | 100,124 |
| Inbox     | 184,732 | 184,728 |

These app sizes are effectively unchanged. The unused-view improvement is useful for component libraries and optional views; it is not evidence of a large reduction in these apps.

`npm run measure:bundles` reports fixture sizes and retained module contributions. CI checks a 2.5 KB gzip budget for the static renderer and verifies that an unused view neither leaves its template marker nor retains extra runtime code.

## Remaining opportunities

Follow-up implementation: `modelOwner` now replaces LocalChat and Inbox's duplicated owner code, including transactions and task policies. `observeQuery` publishes typed Effect results and owns their disposal. Both are part of the existing package; see the authoring guide.

The compiler still uses conservative syntactic purity checks. Native event handling is more useful now, but arbitrary mutable local computations and custom DOM adapters should not be assumed to work inside views. Further relaxation needs explicit contracts and regression cases from real components.

Larger application bundle savings should be measured by retained modules before changing the runtime. Effect already serves the applications' non-UI code; removing its Atom usage solely for the tiny program benchmark would introduce a second notification implementation without proving an app-level win.

## Validation and release boundary

- Framework: formatting, Oxlint/type checks, Clippy, 123 unit tests, 9 Rust tests, browser types and 25 browser tests.
- Clean package consumer: native loading, declarations, Vite build, browser execution and all Lucide import paths.
- All 45 consumer TSX files compile with the final compiler. Its event-analysis changes produce the same generated code as the compiler used for the app browser runs.
- All three app builds and type/lint checks pass. TeleVecha: 299 unit / 302 browser tests; LocalChat: 28 unit / 23 browser tests (13 existing skips); Inbox: 16 unit / 36 browser tests. LocalChat retains its existing advisory lint warnings. Inbox's browser tests run from an isolated copy with fixture storage and the newly built assets, preserving the live server's `dist` directory.

The renamed APIs require a coordinated package release before a clean install of the updated consumers. Their manifests and lockfiles still reference the published version; local testing installed tarballs without saving dependency changes. Do not treat these installed development packages as published releases. Publish a new runtime/compiler version and update consumer dependency versions together; the alias-free change intentionally does not support the old import names.

## Owner, query, compiler and list follow-up

All four follow-up changes remain in the existing packages. `modelOwner` replaces duplicated LocalChat and Inbox model/task ownership, including atomic transactions and replace/drop/parallel task policies. Inbox query subscriptions now use `observeQuery` and keep Effect `AsyncResult` values. Views accept destructured inputs, with direct field dependencies for simple patterns and a cached derivation for complex patterns. Lists skip movement planning when retained identities stay in order, including tail appends and truncations.

The 1,000-row browser fixture measured median single-row edit CPU time at 0.335 ms before and 0.210 ms after (seven rounds, 30 edits per round). Both versions retained row DOM identity and changed only the edited label. This is about 37% less CPU for that workload, not a general app speedup; prepend and branch-remount measurements did not improve. The baseline forced the previous unconditional movement-planning path while retaining the other changes.

LocalChat's JavaScript gzip total changed from 100,124 to 100,645 bytes; Inbox's from 184,728 to 185,332 bytes before the small editor-focus fix. TeleVecha changed from 422,032 to 422,167 bytes. The authoring helpers add a modest amount of code when used; the static-view fixture remains about 2.1 KB gzip. Bundle measurement now includes owner and owned-query fixtures.

Follow-up validation: 137 framework unit tests, nine Rust tests, 27 framework browser tests, clean package consumption, and formatting/lint/type/Clippy checks pass. TeleVecha passed 299 unit and 302 browser tests, with 36 targeted browser tests repeated against the final packages. LocalChat passed 28 unit and 23 browser tests, with its 13 existing skips. Inbox passed 16 unit and all 37 browser tests in the final run. A browser regression reproduces deferred editor activation stealing explicit tab focus on the earlier build and verifies the fix.

These changes are tested with local packed dependencies. They remain unpublished and have not been deployed to the live Inbox services.
