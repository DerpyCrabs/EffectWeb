export type { JSX } from './jsx.js';
import { markup } from './dom.js';
import type { JSX } from './jsx.js';

export function Fragment(props: { readonly children?: JSX.Element }): JSX.Element {
  return props.children;
}

const tags = new Map<string, ReturnType<typeof markup>>();
function factory(type: string) {
  let render = tags.get(type);
  if (!render) tags.set(type, (render = markup(type)));
  return render;
}
export function jsx(
  type: string | ((props: never) => JSX.Element),
  props: Readonly<Record<string, unknown>>,
): JSX.Element {
  if (typeof type !== 'string') return type(props as never);
  if (!Object.hasOwn(props, 'children')) return factory(type)(props);
  const { children, ...attrs } = props;
  return factory(type)(attrs, children);
}
/** Static children arrays keep one binding per child. */
export function jsxs(
  type: string | ((props: never) => JSX.Element),
  props: Readonly<Record<string, unknown>>,
): JSX.Element {
  if (typeof type !== 'string') return type(props as never);
  const { children, ...attrs } = props;
  return Array.isArray(children)
    ? factory(type)(attrs, ...(children as unknown[]))
    : factory(type)(attrs, children);
}
export function jsxDEV(
  type: string | ((props: never) => JSX.Element),
  props: Readonly<Record<string, unknown>>,
  _key?: unknown,
  isStatic?: boolean,
): JSX.Element {
  return isStatic ? jsxs(type, props) : jsx(type, props);
}
