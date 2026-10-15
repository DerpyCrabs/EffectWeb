import { view } from 'effectweb';
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
  type ScrollAreaHandle,
} from '@effectweb/base-ui/scroll-area';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';
export {
  createScrollArea,
  ScrollAreaContent,
  type ScrollAreaHandle,
} from '@effectweb/base-ui/scroll-area';
/** Styled ScrollBar part with native attributes and theme classes. */
export const ScrollBar = view<
  Native<'div'> &
    Styled & {
      readonly scrollArea: ScrollAreaHandle;
      readonly orientation?: 'horizontal' | 'vertical' | undefined;
    }
>(({ class: className, scrollArea, orientation = 'vertical', ...rest }) => (
  <ScrollAreaScrollbar
    {...rest}
    scrollArea={scrollArea}
    orientation={orientation}
    data-slot="scroll-area-scrollbar"
    class={cn(
      'flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent',
      className,
    )}
  >
    <ScrollAreaThumb
      scrollArea={scrollArea}
      orientation={orientation}
      data-slot="scroll-area-thumb"
      class="relative flex-1 rounded-full bg-border"
    />
  </ScrollAreaScrollbar>
));
/** Styled ScrollArea part with native attributes and theme classes. */
export const ScrollArea = view<
  Native<'div'> &
    Styled & { readonly scrollArea: ScrollAreaHandle; readonly horizontal?: boolean | undefined }
>(({ class: className, scrollArea, horizontal, children, ...rest }) => (
  <ScrollAreaRoot
    {...rest}
    scrollArea={scrollArea}
    data-slot="scroll-area"
    class={cn('relative', className)}
  >
    <ScrollAreaViewport
      scrollArea={scrollArea}
      data-slot="scroll-area-viewport"
      class="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
    >
      {children}
    </ScrollAreaViewport>
    <ScrollBar scrollArea={scrollArea} />
    {horizontal ? <ScrollBar scrollArea={scrollArea} orientation="horizontal" /> : null}
    <ScrollAreaCorner scrollArea={scrollArea} />
  </ScrollAreaRoot>
));
