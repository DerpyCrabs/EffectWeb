# @effectweb/tanstack-router

EffectWeb adapter for TanStack Router Core.

- `createRouter` keeps TanStack's route-tree inference and navigation types.
- `RootRoute` and `Route` expose TanStack's route constructors: matching, params, validated search, redirects, loaders and errors remain in the core.
- `mountRouter(router)` owns the history subscription in an Effect scope and returns an EffectWeb `Source` of router state.
- The store adapter batches publications and copies plain state before EffectWeb freezes it. It never freezes TanStack's internal match records.
- The host program subscribes to that Source and renders its own matching views. Scope cleanup releases the Source, subscriptions and owned history.
- `createLink(router)` returns a typed `<Link>`: `to`, `params` and `search` are checked against the route tree. It renders a real `<a href>` (middle-click, copy link and screen readers keep working) and navigates in place on plain left clicks. Pass `active` from your route model to set `aria-current="page"`.

```tsx
const Link = createLink(router);

<Link to="/files/$name" params={{ name: file.name }} active={route.name === file.name}>
  {file.name}
</Link>;
```

Prefer `<Link>` to buttons that call `navigate(path: string)`: string paths lose route typing, and buttons are not links for keyboard, assistive technology or new-tab navigation.

Currently there is no JSX Outlet API, route-level view/error boundary system, SSR adapter or file-route generator. Those can build on this binding without introducing a second route matcher.
