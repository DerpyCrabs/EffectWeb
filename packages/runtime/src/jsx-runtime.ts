export type { JSX } from './jsx.js';
import { markup } from './dom.js';
import type { JSX } from './jsx.js';

export function Fragment(props: { readonly children?: JSX.Element }): JSX.Element {
  return props.children;
}

const tags = new Map<string, ReturnType<typeof markup>>();
export function jsx(
  type: string | ((props: never) => JSX.Element),
  props: Readonly<Record<string, unknown>>,
): JSX.Element {
  if (typeof type !== 'string') return type(props as never);
  let render = tags.get(type);
  if (!render) tags.set(type, (render = markup(type)));
  return render(props);
}
export { jsx as jsxs, jsx as jsxDEV };
