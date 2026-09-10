import type { JSX, View } from 'effectweb';

export type LucideProps = JSX.IntrinsicElements['svg'] & {
  size?: number | string | undefined;
  color?: string | undefined;
  strokeWidth?: number | string | undefined;
  absoluteStrokeWidth?: boolean | undefined;
  title?: string | undefined;
};

export type LucideIcon = View<LucideProps, never>;

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
