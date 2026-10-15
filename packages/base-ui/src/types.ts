import type { JSX } from 'effectweb';
export type Native<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag];
