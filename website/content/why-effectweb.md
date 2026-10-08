EffectWeb is a UI framework for applications written with Effect. It exists for two reasons: to use Effect in the UI without an adapter layer, and to leave fewer ways for UI code to be wrong.

## Effect without an adapter layer

React and Solid each have their own model of state and time: hooks and a render cycle, or signals and a dependency graph. Using Effect inside them means translating between the two models. Effects are started from hooks or signal effects, their results are copied into the framework's state, cancellation is tied to a lifecycle that was not designed for it, and services have to be threaded through providers or module scope. Each translation is a place where a request outlives its component, a result lands in stale state, or an error type is lost.

EffectWeb has no second model. Views are plain functions of immutable data. Work is an `Effect` run by an owner under a `Scope`; services come from a `Context`; the status of a request is an `AsyncResult`; a `Stream` feeds a reducer as a command. Disposing a component or controller interrupts its work through Effect's own interruption. What you know about Effect applies unchanged, and what the type checker knows about an Effect, its errors and its services, reaches the view that shows the result. [Core concepts](/docs/concepts/)

## Fewer ways to be wrong

Code that compiles and passes the lint has fewer ways to be wrong than in a framework that trusts the author. This matters most for code written by an AI agent from the documentation.

- Published data is immutable and typed as you declared it. Development builds freeze it, so a mutation throws where it happens instead of showing up as a stale screen later.
- Overlapping work has a key and a policy, such as `replace`, `drop` or `queue`, instead of flags and timers. `owner.task` publishes waiting, success and failure without hand-written state. [Async work](/docs/tasks/)
- Work belongs to an owner, so it cannot outlive the feature that started it. [Controllers](/docs/controllers/)
- Rows are keyed by identity, so focus, drafts and running work stay with the right item. Rendering rows with `.map` is a lint error. [Lists](/docs/lists/)
- The lint rejects impure render work, dispatching while rendering, async event handlers, writes inside a pure `update`, finalizers that overwrite newer work, and `use…` names borrowed from React. Each diagnostic names its fix. [Compiler and lint](/docs/compiler/)
- Where a type error alone would be cryptic, the type carries the fix as its message: a `props` field returned from `init`, actions nested in a controller, a custom query `key`.

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
