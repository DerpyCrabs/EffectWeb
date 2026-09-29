import type { RouterHistory } from '@tanstack/history';
import {
  getUrlScheme,
  isDangerousProtocol,
  type AnyRouter,
  type LinkOptions,
} from '@tanstack/router-core';
import type { JSX } from 'effectweb';
import { jsxComponent } from 'effectweb/jsx';

type Anchor = Omit<JSX.IntrinsicElements['a'], 'href' | 'onClick' | 'target' | 'children'>;
export type LinkProps<
  Router extends AnyRouter,
  From extends string = string,
  To extends string | undefined = '.',
> = LinkOptions<Router, From, To> &
  Anchor & {
    /** Mark the link as the current page (`aria-current="page"`). Derive it from your route model. */
    readonly active?: boolean;
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
  'disabled',
  'active',
  'children',
] as const;

/** Resolve a typed destination to an href and a click handler that navigates in place. */
export function linkTarget(
  router: AnyRouter,
  props: LinkOptions<AnyRouter, string, string> & Pick<Anchor, 'download'>,
) {
  const explicitHref = props.href;
  const blocked =
    explicitHref !== undefined && isDangerousProtocol(explicitHref, router.protocolAllowlist);
  const absoluteHref =
    explicitHref !== undefined && getUrlScheme(explicitHref) ? explicitHref : undefined;
  const location = absoluteHref || blocked ? undefined : router.buildLocation(props as never);
  const external = absoluteHref !== undefined || location?.external === true;
  const publicHref = absoluteHref ?? location?.publicHref;
  const history = router.history as RouterHistory;
  const href: string | undefined =
    props.disabled || blocked
      ? undefined
      : props.reloadDocument || external
        ? publicHref
        : history.createHref(publicHref!);
  const onClick = (event: ClickEvent) => {
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
    router.navigate(props as never).catch((error: unknown) => {
      console.error('Router navigation failed', error);
    });
  };
  return { href, onClick };
}

/**
 * Create a typed `<Link>` for one router. It renders a real `<a href>` (middle-click,
 * copy link and accessibility keep working) and navigates in place on plain clicks.
 */
export function createLink<Router extends AnyRouter>(router: Router) {
  function Link<const From extends string = string, const To extends string | undefined = '.'>(
    this: never,
    props: LinkProps<Router, From, To>,
  ): JSX.Element {
    const target = linkTarget(router, props as never);
    const attributes = { ...(props as Record<string, unknown>) };
    for (const name of options) delete attributes[name];
    return (
      <a
        {...(attributes as Anchor)}
        href={target.href}
        target={props.target}
        aria-current={props.active ? 'page' : undefined}
        aria-disabled={props.disabled ? 'true' : undefined}
        onClick={target.onClick}
      >
        {props.children}
      </a>
    );
  }
  return Object.assign(Link, { [jsxComponent]: true as const });
}
