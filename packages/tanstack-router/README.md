# @effectweb/tanstack-router

EffectWeb adapter for TanStack Router Core.

- `createRouter` keeps TanStack's route-tree inference and navigation types.
- `RootRoute` and `Route` expose TanStack's route constructors: matching, params, validated search, redirects, loaders and errors remain in the core.
- `mountRouter(router)` owns the history subscription in an Effect scope and returns an EffectWeb `Source` of router state.
- The store adapter batches publications and copies plain state before EffectWeb freezes it. It never freezes TanStack's internal match records.
- The host program subscribes to that Source and renders its own matching views. Scope cleanup releases the Source, subscriptions and owned history.

Currently there is no JSX Link/Outlet API, route-level view/error boundary system, SSR adapter or file-route generator. Those can build on this binding without introducing a second route matcher.
