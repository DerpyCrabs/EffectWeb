These packages connect existing libraries to EffectWeb. The library keeps its own behavior; the adapter publishes copies of its state as immutable snapshots and ties its subscriptions to an owner. Install them at the same version as `effectweb`.

## Routing

`@effectweb/tanstack-router` uses TanStack Router for matching, route trees, loaders, search validation and redirects.

- `createRouter(options)` creates the router with full type inference.
- `mountRouter(router)`, inside an Effect scope, returns a source of the router state.
- `const Link = createLink(router)` creates typed links. A `/files/$name` route is linked as `<Link to="/files/$name" params={{ name }}>`. The result is a real anchor, so middle-click and "copy link" work.

Your app chooses which view to show for the current match. There is no `<Outlet>`, file-based routing or server rendering. See the [TanStack Router docs](https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts) for route concepts.

## Forms

`@effectweb/tanstack-form` wraps TanStack Form Core. See [Forms](/docs/forms/#large-forms) for a complete example.

## Tables

`@effectweb/tanstack-table` targets TanStack Table Core v9. `createTable(options, project)` returns the upstream table, a source and a disposer. In `project`, return plain data only: row ids, cell values, selection state. The result is copied with `structuredClone`, so returning `Row`, `Column` or `Table` objects throws. Register the adapter with `owner.own(…)` and render the rows with [`list`](/docs/lists/).

## Authentication

`@effectweb/keycloak` wraps a `keycloak-js` client. Inside an Effect scope, `mountKeycloak(client, initOptions)` returns a source with the authenticated state, the user's identity and realm roles, and the last refresh error. `token`, `login` and `logout` are Effects.

Tokens stay inside the SDK and never appear in snapshots. Tokens are refreshed in the background (by default every 10 seconds, keeping at least 30 seconds of validity). A failed refresh is reported as `refreshError` and retried. Authorization decisions remain your app's job.

## JSON-driven UI

`@effectweb/json-render` renders a JSON UI spec using components you register. Build the catalog with `defineCatalog` and `@effectweb/json-render/schema`, bind implementations with `defineRegistry`, and render with `<Renderer spec={…} state={…} registry={…} dispatch={…} />`.

The renderer emits actions; your app decides whether and how to run them. Unknown components can show a fallback, and missing nodes are skipped, so partially streamed specs render. There is no built-in widget set.

## Icons

Import each icon from its own module:

```tsx check
import { view } from 'effectweb';
import Camera from '@effectweb/lucide/icons/camera';
import DeleteOutlined from '@effectweb/antd-icons/icons/DeleteOutlined';

export const Toolbar = view<{}>(() => (
  <div>
    <button>
      <Camera size={18} /> Add photo
    </button>
    <button aria-label="Delete photo">
      <DeleteOutlined />
    </button>
  </div>
));
```

- Lucide names are kebab-case (`camera`, `circle-help`); Ant Design names are PascalCase (`DeleteOutlined`). Browse the [Lucide](https://lucide.dev/icons/) and [Ant Design](https://ant.design/components/icon) catalogs.
- Lucide props: `size` (default 24), `color` (default `currentColor`), `strokeWidth` (default 2). Ant Design icons default to `1em`.
- Icons are decorative unless you give them a `title` or `aria-label`. An icon-only button needs its own `aria-label`, as above.
- For an icon chosen at runtime, `loadIcon(name)` from `@effectweb/lucide/dynamic` loads it as an Effect; check the name first with `isIconName`.
- `@effectweb/lucide/data` and `@effectweb/lucide/build` expose the raw SVG data and builders, for favicons and other non-component uses.

## Writing an adapter

To connect another library, use `projectionSource` from `effectweb/advanced`. Project the library's state into plain data, call `changed()` when the library notifies you, and dispose its subscriptions together with the source. The existing adapters in the repository are good starting points.
