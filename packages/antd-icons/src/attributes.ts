import { view, type JSX, type View } from 'effectweb';
// oxlint-disable-next-line no-restricted-imports -- Icon modules are generated output; they build markup like compiled JSX.
import { markup } from 'effectweb/dom';

export type AntDesignIconProps = JSX.IntrinsicElements['svg'] & {
  size?: number | string | undefined;
  title?: string | undefined;
  twoToneColor?: string | readonly [primary: string, secondary: string] | undefined;
};
export type AntDesignIcon = View<AntDesignIconProps, never>;

function toneStyle(
  color: NonNullable<AntDesignIconProps['twoToneColor']>,
  style: AntDesignIconProps['style'],
) {
  const [primary, secondary] =
    typeof color === 'string' ? [color, `color-mix(in srgb, ${color} 20%, transparent)`] : color;
  return typeof style === 'string'
    ? `--ant-icon-primary:${primary};--ant-icon-secondary:${secondary};${style}`
    : { '--ant-icon-primary': primary, '--ant-icon-secondary': secondary, ...style };
}
/** The SVG attributes for an icon: size, accessible title or hidden state, and the caller's own attributes. */
export function iconAttributes(props: AntDesignIconProps, name: string, viewBox: string) {
  const {
    size = '1em',
    title,
    twoToneColor,
    style,
    children: _children,
    class: className,
    ...attributes
  } = props;
  const labelled = Boolean(title || attributes['aria-label'] || attributes['aria-labelledby']);
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox,
    fill: 'currentColor',
    focusable: false,
    'aria-hidden': labelled ? undefined : true,
    role: labelled ? 'img' : undefined,
    ...attributes,
    style: twoToneColor ? toneStyle(twoToneColor, style) : style,
    class: ['anticon', `anticon-${name}`, className].filter(Boolean).join(' '),
  };
}

/** One SVG shape from the Ant Design icon definition. */
export interface IconNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly children?: readonly IconNode[];
}
const factories = new Map<string, ReturnType<typeof markup>>();
const factory = (tag: string) => {
  let render = factories.get(tag);
  if (!render) factories.set(tag, (render = markup(tag)));
  return render;
};
const shape = (node: IconNode): JSX.Element =>
  factory(node.tag)(node.attrs, ...(node.children ?? []).map(shape));
/** Define an icon view from Ant Design geometry; the shapes are built once and shared. */
export function antDesignIcon(
  name: string,
  viewBox: string,
  nodes: readonly IconNode[],
): AntDesignIcon {
  let geometry: JSX.Element[] | undefined;
  return view((props) =>
    factory('svg')(
      iconAttributes(props, name, viewBox),
      props.title ? factory('title')(null, props.title) : null,
      ...(geometry ??= nodes.map(shape)),
      props.children,
    ),
  );
}
