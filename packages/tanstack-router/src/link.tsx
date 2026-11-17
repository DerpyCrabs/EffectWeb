import type { RouterHistory } from '@tanstack/history';
import {
  deepEqual,
  exactPathTest,
  getUrlScheme,
  hasKeys,
  isDangerousProtocol,
  preloadWarning,
  removeTrailingSlash,
  type AnyRouter,
  type LinkOptions,
  type ParsedLocation,
} from '@tanstack/router-core';
import { composeMounts, domBinding, mapSource, observe, type JSX, type Source } from 'effectweb';
import { jsxComponent } from 'effectweb/jsx';
import { routerPublications } from './router.js';

type Anchor = Omit<JSX.IntrinsicElements['a'], 'href' | 'target' | 'children'>;
export type LinkProps<
  Router extends AnyRouter,
  From extends string = string,
  To extends string | undefined = '.',
> = LinkOptions<Router, From, To> &
  Anchor & {
    /**
     * Override the active state computed from the router's location and `activeOptions`.
     * Active links carry `data-status="active"` and `aria-current="page"`.
     */
    readonly active?: boolean | undefined;
    readonly children?: JSX.Element;
  };

type ClickEvent = Pick<
  MouseEvent,
  'button' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'defaultPrevented' | 'preventDefault'
>;
const options = [
  'to',
  'from',
  'params',
  'search',
  'hash',
  'state',
  'mask',
  'replace',
  'resetScroll',
  'hashScrollIntoView',
  'viewTransition',
  'ignoreBlocker',
  'reloadDocument',
  'href',
  'activeOptions',
  'preload',
  'preloadDelay',
  'preloadIntentProximity',
  'unsafeRelative',
  'disabled',
  'active',
  'children',
] as const;

type Target = LinkOptions<AnyRouter, string, string> & Pick<Anchor, 'download'>;
type ActiveOptions = NonNullable<LinkOptions<AnyRouter, string, string>['activeOptions']>;

/** Resolve a typed destination to an href and a click handler that navigates in place. */
export function linkTarget(router: AnyRouter, props: Target) {
  const explicitHref = props.href;
  const blocked =
    explicitHref !== undefined && isDangerousProtocol(explicitHref, router.protocolAllowlist);
  const absoluteHref =
    explicitHref !== undefined && getUrlScheme(explicitHref) ? explicitHref : undefined;
  const location: ParsedLocation<Record<string, unknown>> | undefined =
    absoluteHref || blocked
      ? undefined
      : (router.buildLocation(props as never) as ParsedLocation<Record<string, unknown>>);
  const external = absoluteHref !== undefined || location?.external === true;
  const publicHref = absoluteHref ?? location?.publicHref;
  const history = router.history as RouterHistory;
  const href: string | undefined =
    props.disabled || blocked
      ? undefined
      : props.reloadDocument || external
        ? publicHref
        : history.createHref(publicHref!);
  const onClick = (event: ClickEvent, started?: (pending: Promise<void>) => void) => {
    const plain =
      event.button === 0 &&
      !event.metaKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.defaultPrevented;
    if (props.disabled || blocked) {
      event.preventDefault();
      return;
    }
    // Let the browser handle new tabs, downloads and full reloads.
    const download = props.download !== undefined && props.download !== false;
    if (
      !plain ||
      external ||
      download ||
      props.reloadDocument ||
      (props.target && props.target !== '_self')
    )
      return;
    event.preventDefault();
    const pending = router.navigate(props as never).catch((error: unknown) => {
      console.error('Router navigation failed', error);
    });
    started?.(pending);
  };
  return { href, onClick, external, location };
}

/**
 * Whether a destination matches the current location the way TanStack's `Link` decides it:
 * a path prefix (or the exact path), search params as a partial (or exact) match, and the
 * hash only when `includeHash` asks for it.
 */
export function isActiveLocation(
  router: AnyRouter,
  current: ParsedLocation<Record<string, unknown>>,
  next: ParsedLocation<Record<string, unknown>>,
  activeOptions: ActiveOptions | undefined,
) {
  const exact = activeOptions?.exact ?? false;
  if (exact) {
    if (!exactPathTest(current.pathname, next.pathname, router.basepath)) return false;
  } else {
    const currentPath = removeTrailingSlash(current.pathname, router.basepath);
    const nextPath = removeTrailingSlash(next.pathname, router.basepath);
    if (
      !(
        currentPath.startsWith(nextPath) &&
        (currentPath.length === nextPath.length || currentPath[nextPath.length] === '/')
      )
    )
      return false;
  }
  if (activeOptions?.includeSearch ?? true) {
    const currentSearch = current.search as unknown;
    const nextSearch = next.search as unknown;
    if (currentSearch !== nextSearch) {
      const empty = (search: unknown) =>
        !search || (typeof search === 'object' && !hasKeys(search as Record<string, unknown>));
      if (
        !(empty(currentSearch) && empty(nextSearch)) &&
        !deepEqual(currentSearch, nextSearch, !exact, !!activeOptions?.explicitUndefined)
      )
        return false;
    }
  }
  if (activeOptions?.includeHash) return current.hash === next.hash;
  return true;
}

type Location = ParsedLocation<Record<string, unknown>>;
const transitions = new WeakMap<HTMLAnchorElement, Promise<unknown>>();
const locations = new WeakMap<AnyRouter, Source<Location>>();
/** The router's current location as a source; publications follow every router store write. */
export function routerLocation(router: AnyRouter): Source<Location> {
  let source = locations.get(router);
  if (!source) {
    const listeners = routerPublications(router);
    const read = () => router.state.location as Location;
    const raw: Source<Location> = {
      model: read,
      subscribe: (listener) => {
        const notify = () => listener(read());
        listeners.add(notify);
        return () => listeners.delete(notify);
      },
    };
    source = mapSource(raw, (value) => value);
    locations.set(router, source);
  }
  return source;
}

type Preload = false | 'intent' | 'viewport' | 'render';
interface PreloadInput {
  readonly router: AnyRouter;
  readonly options: Target;
  readonly preload: Preload | undefined;
  readonly delay: number;
  readonly href?: string | undefined;
  readonly disabled: boolean;
}
const viewportMargin = { rootMargin: '100px' };
// Preloading an anchor: `intent` waits for the delay on hover or focus, `viewport` observes
// intersection, `render` runs once when the link appears.
const acquirePreload = (element: HTMLElement, current: () => PreloadInput) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rendered: string | undefined;
  const win = element.ownerDocument.defaultView!;
  let proximity = false;
  let inside = false;
  let observer: IntersectionObserver | undefined;
  const run = () => {
    const { router, options, disabled } = current();
    if (disabled) return;
    router.preloadRoute(options as never).catch((error: unknown) => {
      console.warn(error);
      console.warn(preloadWarning);
    });
  };
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const intent = () => {
    const { preload, delay, disabled } = current();
    if (disabled || preload !== 'intent') return;
    if (!delay) return run();
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delay);
    }
  };
  const move = (event: PointerEvent) => {
    const { router, options } = current();
    const distance =
      options.preloadIntentProximity ?? router.options.defaultPreloadIntentProximity ?? 0;
    const box = element.getBoundingClientRect();
    const near =
      event.clientX >= box.left - distance &&
      event.clientX <= box.right + distance &&
      event.clientY >= box.top - distance &&
      event.clientY <= box.bottom + distance;
    if (near && !inside) intent();
    if (!near && inside) clear();
    inside = near;
  };
  const touch = () => {
    if (current().preload === 'intent') run();
  };
  const sync = () => {
    const { preload, disabled, router, options, href } = current();
    const track =
      preload === 'intent' &&
      !disabled &&
      (options.preloadIntentProximity ?? router.options.defaultPreloadIntentProximity ?? 0) > 0;
    if (track !== proximity) {
      proximity = track;
      inside = false;
      if (track) win.addEventListener('pointermove', move);
      else win.removeEventListener('pointermove', move);
    }
    if (preload === 'viewport' && !disabled) {
      if (!observer && typeof win.IntersectionObserver !== 'undefined') {
        observer = new win.IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) run();
        }, viewportMargin);
        observer.observe(element);
      }
    } else {
      observer?.disconnect();
      observer = undefined;
    }
    if (preload === 'render' && !disabled) {
      const destination = href ?? router.buildLocation(options as never).href;
      if (destination !== rendered) {
        rendered = destination;
        run();
      }
    } else rendered = undefined;
    if (preload !== 'intent') clear();
  };
  element.addEventListener('pointerenter', intent);
  element.addEventListener('focus', intent);
  element.addEventListener('pointerleave', clear);
  element.addEventListener('blur', clear);
  element.addEventListener('touchstart', touch, { passive: true });
  sync();
  return {
    update: sync,
    dispose: () => {
      clear();
      win.removeEventListener('pointermove', move);
      observer?.disconnect();
      element.removeEventListener('pointerenter', intent);
      element.removeEventListener('focus', intent);
      element.removeEventListener('pointerleave', clear);
      element.removeEventListener('blur', clear);
      element.removeEventListener('touchstart', touch);
    },
  };
};
/** Preload a destination on intent, in the viewport or on render, for any anchor-like element. */
export const linkPreloadBinding = (input: PreloadInput) => domBinding(input, acquirePreload);

/**
 * Create a typed `<Link>` for one router. It renders a real `<a href>` (middle-click,
 * copy link and accessibility keep working), navigates in place on plain clicks, marks
 * itself active against the current location, and preloads per `preload` or the router's
 * `defaultPreload`.
 */
export function createLink<Router extends AnyRouter>(router: Router) {
  const location = routerLocation(router);
  function Link<const From extends string = string, const To extends string | undefined = '.'>(
    this: never,
    props: LinkProps<Router, From, To>,
  ): JSX.Element {
    const attributes = { ...(props as Record<string, unknown>) };
    for (const name of options) delete attributes[name];
    const disabled = !!props.disabled;
    return observe(location, (current) => {
      const target = linkTarget(router, props as never);
      const preload: Preload | undefined =
        props.reloadDocument || target.external
          ? false
          : ((props.preload ?? router.options.defaultPreload) as Preload | undefined);
      const delay = props.preloadDelay ?? router.options.defaultPreloadDelay ?? 0;
      const active =
        props.active ??
        (!target.external &&
          target.location !== undefined &&
          isActiveLocation(
            router,
            current,
            target.location as ParsedLocation,
            props.activeOptions,
          ));
      return (
        <a
          {...(attributes as Anchor)}
          href={target.href}
          target={props.target}
          use={composeMounts([
            props.use,
            linkPreloadBinding({
              router,
              options: props as never,
              preload,
              delay,
              disabled,
              href: target.href,
            }),
          ])}
          data-status={active ? 'active' : undefined}
          aria-current={active ? 'page' : undefined}
          role={disabled ? 'link' : undefined}
          aria-disabled={disabled ? 'true' : undefined}
          onClick={(event) => {
            const element = event.currentTarget;
            const result = props.onClick?.(event);
            target.onClick(event, (navigation) => {
              transitions.set(element, navigation);
              element.dataset.transitioning = 'transitioning';
              void navigation.then(() => {
                if (transitions.get(element) === navigation) {
                  transitions.delete(element);
                  delete element.dataset.transitioning;
                }
              }, console.error);
            });
            return result;
          }}
        >
          {props.children}
        </a>
      );
    });
  }
  return Object.assign(Link, { [jsxComponent]: true as const });
}
