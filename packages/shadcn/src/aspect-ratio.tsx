import { controlStyle } from '@effectweb/base-ui/control-style';
import { view } from 'effectweb';
import type { Native, Styled } from './types.js';
/** Intrinsic CSS aspect ratio; children may use size-full/object-cover. */
export const AspectRatio = view<Native<'div'> & Styled & { readonly ratio?: number | undefined }>(
  ({ ratio = 1, style, ...rest }) => (
    <div
      data-slot="aspect-ratio"
      {...rest}
      style={controlStyle(
        { position: 'relative', width: '100%', aspectRatio: String(ratio > 0 ? ratio : 1) },
        style,
      )}
    />
  ),
);
