# Reading list

A standalone application using the compiled JSX runtime. Add titles, mark them read, filter them, and remove them. The browser adapter persists entries in IndexedDB. The same UI also runs with synchronous Effect storage in the browser tests.

From the repository root:

```sh
npm run dev:example
npm run check:browser
npm run build:example
```

`app.tsx` owns immutable state and messages. The collection declares entry identity once. `main.tsx` adapts the IndexedDB library's Promise interface to Effect; `memoryStorage.ts` implements the same storage contract synchronously. No view changes are needed to switch adapters.

Failed saves keep the edited list visible and offer Retry. Replacement saves cancel the previous caller. The IndexedDB adapter checks cancellation before starting a write; an already-started transaction finishes in database order. This example has one tab's local state and does not implement concurrent editing across tabs.

The example imports `effectweb` and `@effectweb/compiler/vite` through the workspace packages. Run `npm ci && npm run build` in the repository root before starting it.

The app supplies `ReadingStorage` once through `uiRuntime(Context.make(...)).program(...)`. Command Effects read that service directly; their required service is checked before the program is created. The storage boundary converts expected failures to the tagged `StorageError` type. This runtime binds an existing context and does not allocate another cache or own the storage service lifetime.
