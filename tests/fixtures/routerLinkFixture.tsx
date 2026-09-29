import { Effect } from 'effect';
import { view } from 'effectweb';
import { renderView } from 'effectweb/testing';
import {
  createLink,
  createMemoryHistory,
  createRouter,
  RootRoute,
  Route,
} from '@effectweb/tanstack-router';

export async function mountLinks(parent: HTMLElement) {
  const history = createMemoryHistory({ initialEntries: ['/'] });
  const root = new RootRoute();
  const file = new Route({ getParentRoute: () => root, path: 'files/$name' });
  const router = createRouter({ routeTree: root.addChildren([file]), history });
  await router.load();
  const Link = createLink(router);
  const Nav = view<{ current: string }>((model) => (
    <nav>
      <Link
        to="/files/$name"
        params={{ name: 'notes' }}
        class="file"
        active={model.current === 'notes'}
      >
        Notes
      </Link>
      <Link to="/" disabled>
        Home
      </Link>
      <Link href="https://example.com/report?x=1#part" class="external">
        External report
      </Link>
      <Link to="/files/$name" params={{ name: 'report' }} download="" class="download">
        Download report
      </Link>
    </nav>
  ));
  const rendered = renderView(parent, Nav, { current: '' });
  return {
    rendered,
    pathname: () => history.location.pathname,
    close: () => Effect.runPromise(rendered.close()),
  };
}
