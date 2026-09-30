import { view, type JSX, type View } from 'effectweb';
// oxlint-disable-next-line no-restricted-imports -- Icon modules are generated output; they build markup like compiled JSX.
import { markup } from 'effectweb/dom';

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
    class: ['lucide', names, className].filter(Boolean).join(' '),
  };
}

/** One SVG shape: tag, attributes and optional nested shapes, as published by Lucide. */
export type IconNode = readonly [
  tag: string,
  attributes: Readonly<Record<string, string | number>>,
  children?: readonly IconNode[],
];
const factories = new Map<string, ReturnType<typeof markup>>();
const factory = (tag: string) => {
  let render = factories.get(tag);
  if (!render) factories.set(tag, (render = markup(tag)));
  return render;
};
const shape = ([tag, attributes, children]: IconNode, absolute: boolean): JSX.Element =>
  factory(tag)(
    absolute ? { 'vector-effect': 'non-scaling-stroke', ...attributes } : attributes,
    ...(children ?? []).map((child) => shape(child, absolute)),
  );
/**
 * Define an icon view from Lucide geometry. The shapes never change, so their markup is built
 * once per stroke mode and shared by every mounted instance.
 */
export function lucideIcon(
  names: string,
  width: number,
  height: number,
  nodes: readonly IconNode[],
): LucideIcon {
  const geometry: [JSX.Element[]?, JSX.Element[]?] = [];
  const shapes = (absolute: boolean) =>
    (geometry[absolute ? 1 : 0] ??= nodes.map((node) => shape(node, absolute)));
  return view((props) =>
    factory('svg')(
      iconAttributes(props, names, width, height),
      props.title ? factory('title')(null, props.title) : null,
      ...shapes(Boolean(props.absoluteStrokeWidth)),
      props.children,
    ),
  );
}
