import type { JSX, View } from 'effectweb';
// oxlint-disable-next-line no-restricted-imports -- Precompiled icon integration owns raw DOM bindings and their scopes.
import { attach, attribute, compiled, bindEvent } from 'effectweb/dom';

export type LucideProps = JSX.IntrinsicElements['svg'] & {
  size?: number | string | undefined;
  color?: string | undefined;
  strokeWidth?: number | string | undefined;
  absoluteStrokeWidth?: boolean | undefined;
  title?: string | undefined;
};

export type LucideIcon = View<LucideProps, never>;

/** Generated views have exactly one SVG root. Geometry stays owned by the compiler. */
export function withIconAttributes(
  geometry: LucideIcon,
  names: string,
  width: number,
  height: number,
): LucideIcon {
  return compiled((scope, parent, before) => {
    geometry.build(scope, parent, before);
    const svg = (before ? before.previousSibling : parent.lastChild) as SVGSVGElement;
    let previous: Record<string, unknown> = {};
    const listeners = new Set<string>();
    scope.watch(
      () => [scope.value],
      () => {
        const next: Record<string, unknown> = iconAttributes(scope.value, names, width, height);
        for (const name of new Set([...Object.keys(previous), ...Object.keys(next)])) {
          if (name === 'use') continue;
          if (/^on[A-Z]/u.test(name)) {
            if (!listeners.has(name) && typeof next[name] === 'function') {
              listeners.add(name);
              bindEvent(
                scope,
                svg,
                name,
                () => [(scope.value as Record<string, unknown>)[name]],
                () => (scope.value as Record<string, unknown>)[name],
              );
            }
          } else if (!Object.is(previous[name], next[name])) {
            attribute(svg, name, next[name]);
          }
        }
        previous = next;
      },
    );
    attach(
      scope,
      svg,
      () => [scope.value.use],
      () => scope.value.use,
    );
  });
}

/** Keep icon-only options off the DOM; ordinary SVG attributes remain overridable. */
export function iconAttributes(props: LucideProps, names: string, width: number, height: number) {
  const {
    size = 24,
    color = 'currentColor',
    strokeWidth = 2,
    absoluteStrokeWidth: _absolute,
    title,
    children: _children,
    class: className,
    className: alternateClassName,
    ...attributes
  } = props;
  const labelled = Boolean(title || attributes['aria-label'] || attributes['aria-labelledby']);
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: `0 0 ${width} ${height}`,
    fill: 'none',
    stroke: color,
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': labelled ? undefined : true,
    role: labelled ? 'img' : undefined,
    ...attributes,
    class: ['lucide', names, className, alternateClassName].filter(Boolean).join(' '),
  };
}
