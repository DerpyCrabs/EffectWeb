import type { JSX } from 'effectweb';

/** The attributes of a native element, with `class` and `children` left to each component's own props. */
export type Native<Tag extends keyof JSX.IntrinsicElements> = Omit<
  JSX.IntrinsicElements[Tag],
  'class' | 'children'
>;

export interface Styled {
  readonly class?: string | undefined;
  readonly children?: JSX.Element;
}
