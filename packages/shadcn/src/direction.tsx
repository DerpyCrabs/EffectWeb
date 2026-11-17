import { view } from 'effectweb';
import type { Native, Styled } from './types.js';
/** Provides inherited direction to text, native controls and Base UI keyboard navigation. */
export const DirectionProvider = view<Native<'div'> & Styled & { dir: 'ltr' | 'rtl' | 'auto' }>(
  (props) => <div {...props} />,
);
