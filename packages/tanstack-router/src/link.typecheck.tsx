import { createLink, createMemoryHistory, createRouter, RootRoute, Route } from './index.js';

const root = new RootRoute();
const file = new Route({ getParentRoute: () => root, path: 'files/$name' });
const router = createRouter({
  routeTree: root.addChildren([file]),
  history: createMemoryHistory(),
});
const Link = createLink(router);

export const valid = (
  <Link to="/files/$name" params={{ name: 'notes' }} class="nav" active>
    Notes
  </Link>
);
export const home = <Link to="/">Home</Link>;
// @ts-expect-error Unknown routes are rejected by TanStack's route-tree types.
export const missing = <Link to="/missing">Missing</Link>;
// @ts-expect-error Required params are checked for the chosen route.
export const withoutParams = <Link to="/files/$name">File</Link>;

// @ts-expect-error Link preloading is not implemented; use router.preloadRoute explicitly.
export const unsupportedPreload = <Link to="/" preload="intent" />;
