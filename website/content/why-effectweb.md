EffectWeb brings Effect’s model of work into a TypeScript and JSX UI. It is designed for interactive browser apps where requests overlap, people edit lists, and screens close while work is still running.

## Why choose it

**Decide what happens when requests overlap.** Replace the previous search, ignore a duplicate submit, or queue saves in order. Choose a policy on a named task instead of coordinating each case with flags. Tasks can publish loading, success and failure state for the view. [Async work →](/docs/tasks/)

**Give work the same lifetime as the feature.** A component’s work is interrupted when it leaves the page. Controllers let several views share state and work; `controllerView` disposes its controller when the view disappears. Resources still need finalizers, but ownership determines when to run them. [Controllers →](/docs/controllers/)

**Keep updates understandable.** Views read immutable inputs; actions change state. Unchanged child inputs can skip rendering, and keyed rows keep their focus, local state and work when reordered. State that must survive a row’s removal lives in its parent. [Core concepts →](/docs/concepts/)

## What it adds to Effect

Effect supplies typed errors, services, interruption and resource management. EffectWeb adds JSX rendering, UI state, component lifetimes and task policies that connect those tools to the screen. The optional query package adds shared requests, caching and refresh state.

You can use Effect with another UI framework. Choose EffectWeb when you want these conventions built into the UI layer and are comfortable adopting its immutable state and explicit ownership model. You will need to learn Effect as well as the view APIs.

## When to choose something else

- **Content sites or apps that need server rendering:** EffectWeb renders in the browser; it provides neither SSR nor hydration. This documentation site generates static HTML separately at build time.
- **Apps that depend on React components:** those components cannot render as EffectWeb views. Framework-independent libraries can be connected through DOM hooks or adapters.
- **Projects that need a stable 1.0 API:** EffectWeb is still in active development, and APIs can change between releases.
- **Small pages with little interactive state:** the ownership model and Effect dependency may add more concepts than the page needs.

Routing, larger forms, tables and authentication have [adapters](/docs/integrations/), rather than a built-in application stack. Check [installation requirements](/docs/getting-started/) before adopting; a prebuilt musl Linux compiler is not currently available.

Cancellation stops local work; it cannot undo a write the server has already received. [Cancellation is not rollback →](/docs/tasks/#cancellation-is-not-rollback)

Ready to try it? [Build your first app](/docs/getting-started/), then use [Which API to use](/docs/choosing-apis/) as a map to the guides.
