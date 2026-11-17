As a browser app grows, more features share data and start work of their own. EffectWeb gives those features a common structure. A view describes the screen in JSX, a component or controller owns its state, and an owner runs each Effect.

## Effect without an adapter layer

A feature can use the same Effect services, typed errors and cancellation rules as the rest of the application. For example, a search controller starts a request with `owner.task`. Its view reads the task state to show progress, results or an error. Closing the controller interrupts its work. [Core concepts](/docs/concepts/)

## Fewer ways to be wrong

When two searches overlap, the author chooses what should happen. With the `replace` policy, a new search interrupts the previous one and the earlier result cannot overwrite the latest one. The same policy applies anywhere the team uses that API. [Async work](/docs/tasks/)

The compiler and lint rules give authors feedback while they edit. A list rendered with an inline JSX `.map` callback gets a diagnostic with the keyed-list syntax. An agent can read that diagnostic, apply the change and run the check again. The installed package also includes the guides for its own version. [Compiler and lint](/docs/compiler/) · [Which API to use](/docs/choosing-apis/)

## Testing with coding agents

We tested several AI models on the same app-building tasks with EffectWeb, React, and Solid. On average, the apps they built with EffectWeb passed more of our browser tests.

## What it adds to Effect

Effect supplies typed errors, services, interruption and resource management. EffectWeb adds JSX rendering, component state and lifetimes, keyed work with policies, and the compiler that checks views. The optional query package adds shared requests, caching and refresh state.

## When to choose something else

- **Content sites or apps that need server rendering:** EffectWeb renders in the browser; it provides neither SSR nor hydration. This documentation site generates static HTML separately at build time.
- **Apps that depend on React components:** those components cannot render as EffectWeb views. Framework-independent libraries can be connected through DOM hooks or adapters.
- **Projects that need a stable 1.0 API:** EffectWeb is still in active development, and APIs can change between releases.
- **Small pages with little interactive state:** the ownership model and Effect dependency may add more concepts than the page needs.

Routing, larger forms, tables and authentication have [adapters](/docs/integrations/), rather than a built-in application stack. Check [installation requirements](/docs/getting-started/) before adopting; a prebuilt musl Linux compiler is not currently available.

Cancellation stops local work; it cannot undo a write the server has already received. [Cancellation is not rollback](/docs/tasks/#cancellation-is-not-rollback)

Ready to try it? [Build your first app](/docs/getting-started/), then use [Which API to use](/docs/choosing-apis/) as a map to the guides.
