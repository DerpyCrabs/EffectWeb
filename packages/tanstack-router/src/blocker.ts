import type { HistoryAction, HistoryLocation, RouterHistory } from '@tanstack/history';
import type { AnyRouter } from '@tanstack/router-core';
import { mapSource, modelOwner, type Source } from 'effectweb';

/** Where a blocked navigation comes from or goes to, resolved against the route tree. */
export interface BlockerLocation {
  readonly routeId: string;
  readonly fullPath: string;
  readonly pathname: string;
  readonly params: Record<string, unknown>;
  readonly search: Record<string, unknown>;
}
export interface ShouldBlockArgs {
  readonly action: HistoryAction;
  readonly current: BlockerLocation;
  readonly next: BlockerLocation;
}
export interface BlockerOptions {
  /** Decide per navigation; `true` blocks. Defaults to blocking every navigation. */
  readonly shouldBlockFn?: ((args: ShouldBlockArgs) => boolean | Promise<boolean>) | undefined;
  /** Also prompt before the document unloads. Defaults to on. */
  readonly enableBeforeUnload?: boolean | (() => boolean) | undefined;
  /** Publish a `blocked` state with `proceed` and `reset` instead of deciding inside `shouldBlockFn`. */
  readonly withResolver?: boolean | undefined;
}
export type BlockerState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'blocked';
      readonly action: HistoryAction;
      readonly current: BlockerLocation;
      readonly next: BlockerLocation;
      /** Let the navigation through. */
      readonly proceed: () => void;
      /** Keep the current page. */
      readonly reset: () => void;
    };
export interface Blocker {
  readonly source: Source<BlockerState>;
  readonly dispose: () => void;
}

const notFound = '__notFound__';
function resolve(router: AnyRouter, location: HistoryLocation): BlockerLocation {
  const parsed = router.parseLocation(location);
  const [, params, route] = router.getMatchedRoutes(parsed.pathname) as [
    unknown,
    Record<string, unknown>,
    { readonly id: string; readonly fullPath: string } | undefined,
  ];
  const search = router.options.parseSearch(location.search) as Record<string, unknown>;
  return route === undefined
    ? { routeId: notFound, fullPath: parsed.pathname, pathname: parsed.pathname, params, search }
    : { routeId: route.id, fullPath: route.fullPath, pathname: parsed.pathname, params, search };
}

/**
 * Block navigation away from the current page, the counterpart of TanStack's `useBlocker`.
 * With `withResolver`, the published state turns `blocked` and the UI decides through
 * `proceed` or `reset`; otherwise `shouldBlockFn` decides alone. Dispose to unblock.
 */
export function createBlocker(router: AnyRouter, options: BlockerOptions = {}): Blocker {
  const owner = modelOwner<{ state: BlockerState }>({ state: { status: 'idle' } });
  const shouldBlock = options.shouldBlockFn ?? (() => true);
  const history = router.history as RouterHistory;
  const unblock = history.block({
    enableBeforeUnload: options.enableBeforeUnload ?? true,
    blockerFn: async ({ currentLocation, nextLocation, action }) => {
      const current = resolve(router, currentLocation);
      const next = resolve(router, nextLocation);
      // Leaving a not-found page for a real route is never worth blocking.
      if (current.routeId === notFound && next.routeId !== notFound) return false;
      const blocked = await shouldBlock({ action, current, next });
      if (!options.withResolver || !blocked) return blocked;
      const allow = await new Promise<boolean>((decide) => {
        owner.patch({
          state: {
            status: 'blocked',
            action,
            current,
            next,
            proceed: () => decide(false),
            reset: () => decide(true),
          },
        });
      });
      if (!owner.disposed) owner.patch({ state: { status: 'idle' } });
      return allow;
    },
  });
  return {
    source: mapSource(owner.source, (model) => model.state),
    dispose: () => {
      if (owner.disposed) return;
      unblock();
      const state = owner.read().state;
      if (state.status === 'blocked') state.proceed();
      owner.dispose();
    },
  };
}
