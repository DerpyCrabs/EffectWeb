# @effectweb/tanstack-router

EffectWeb adapter for TanStack Router Core.

- `createRouter` keeps TanStack's route-tree inference and navigation types.
- `RootRoute` and `Route` expose TanStack's route constructors: matching, params, validated search, redirects, loaders and errors remain in the core.
- `mountRouter(router)` owns the history subscription in an Effect scope and returns a controller with a `source` of router state. Outside an Effect scope, `createRouterController(router)`, `start()` and `dispose()` provide the same lifetime.
- The store adapter batches publications and copies plain state before EffectWeb freezes it. It never freezes TanStack's internal match records.
- `<RouterView controller={controller} />` renders the matched route views. Each receives `scope.match`, `scope.location`, `scope.navigate`, and `scope.outlet()` for its nested route. Route options support component, pending, error and not-found views. Scope cleanup interrupts loaders, before-load hooks and preloads, settles pending navigation, and releases the Source, subscriptions and owned history. Mount each router only once.
- `createLink(router)` returns a typed `<Link>`: `to`, `params` and `search` are checked against the route tree. It renders a real `<a href>` (middle-click, copy link and screen readers keep working) and navigates in place on plain left clicks. Pass `active` from your route model to set `aria-current="page"`.

```tsx
const Link = createLink(router);

<Link to="/files/$name" params={{ name: file.name }} active={route.name === file.name}>
  {file.name}
</Link>;
```

Prefer `<Link>` to buttons that call `navigate(path: string)`: string paths lose route typing, and buttons are not links for keyboard, assistive technology or new-tab navigation.

File route declarations use `createFileRoute` and `createLazyFileRoute`; `lazyRouteComponent` loads EffectWeb views on demand; its export name defaults to `default`. Speculative preloads never reload the page: recovery from a missing deployed chunk happens only when its view is mounted. The adapter does not ship a file-route generator or an SSR adapter. Matching, loaders, validated search and redirects use TanStack Router Core.

Link preloading and automatic active matching are not exposed as link props. Call `router.preloadRoute(options)` explicitly when needed, and derive `active` from the route model.
