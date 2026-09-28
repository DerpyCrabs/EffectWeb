import type { JSX, View } from 'effectweb';

export type AntDesignIconProps = JSX.IntrinsicElements['svg'] & {
  size?: number | string | undefined;
  title?: string | undefined;
};
export type AntDesignIcon = View<AntDesignIconProps, never>;

export function iconAttributes(props: AntDesignIconProps, name: string, viewBox: string) {
  const {
    size = '1em',
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
    viewBox,
    fill: 'currentColor',
    focusable: false,
    'aria-hidden': labelled ? undefined : true,
    role: labelled ? 'img' : undefined,
    ...attributes,
    class: ['anticon', `anticon-${name}`, className, alternateClassName].filter(Boolean).join(' '),
  };
}
