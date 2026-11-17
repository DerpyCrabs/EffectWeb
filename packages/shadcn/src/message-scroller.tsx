import { composeMounts, domMount, view, viewWindow } from 'effectweb';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

function acquireViewport(el: HTMLDivElement) {
  const win = viewWindow(el);
  let following = true;
  let anchor: Element | null = null;
  const anchorSelector = '[data-scroll-anchor="true"]';
  const notify = () => {
    following = el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
    const root = el.closest('[data-slot="message-scroller"]');
    for (const button of root?.querySelectorAll<HTMLButtonElement>('[data-scroll-direction]') ?? [])
      button.hidden = button.dataset.scrollDirection === 'start' ? el.scrollTop <= 2 : following;
  };
  const resize = new win.ResizeObserver(() => {
    if (following) el.scrollTop = el.scrollHeight;
    notify();
  });
  const sync = () => {
    resize.disconnect();
    resize.observe(el);
    for (const child of el.children) resize.observe(child);
    const nextAnchor = el.querySelectorAll(anchorSelector);
    const latest = nextAnchor.item(nextAnchor.length - 1);
    if (latest && latest !== anchor && following) {
      el.scrollTop += latest.getBoundingClientRect().top - el.getBoundingClientRect().top;
    } else if (following) el.scrollTop = el.scrollHeight;
    anchor = latest;
    notify();
  };
  const observer = new win.MutationObserver(sync);
  observer.observe(el, { childList: true, subtree: true, characterData: true });
  el.addEventListener('scroll', notify);
  sync();
  return () => {
    el.removeEventListener('scroll', notify);
    observer.disconnect();
    resize.disconnect();
  };
}
/** Groups a scrolling transcript and its navigation buttons. */
export const MessageScroller = view<Native<'div'> & Styled>(({ class: className, ...props }) => (
  <div
    data-slot="message-scroller"
    class={cn('relative flex min-h-0 flex-col overflow-hidden', className)}
    {...props}
  />
));
/** Provides a transcript container for colocated navigation controls. */
export const MessageScrollerProvider = MessageScroller;
/** Follows newly appended messages until the reader scrolls away from the end. */
export const MessageScrollerViewport = view<Native<'div'> & Styled>(
  ({ use, class: className, ...props }) => (
    <div
      tabIndex={0}
      data-slot="message-scroller-viewport"
      class={cn('min-h-0 overflow-y-auto overscroll-contain', className)}
      {...props}
      use={composeMounts([use, domMount(acquireViewport)])}
    />
  ),
);
/** Wraps transcript content so its growth can be observed. */
export const MessageScrollerContent = view<Native<'div'> & Styled>((props) => (
  <div data-slot="message-scroller-content" {...props} />
));
/** Marks one transcript entry inside the scrollable content. */
export const MessageScrollerItem = view<Native<'div'> & Styled & { scrollAnchor?: boolean }>(
  ({ scrollAnchor, ...props }) => (
    <div data-slot="message-scroller-item" data-scroll-anchor={scrollAnchor} {...props} />
  ),
);
/** Moves the closest transcript viewport to the start or end. */
export const MessageScrollerButton = view<
  Native<'button'> & Styled & { direction?: 'start' | 'end' }
>(({ direction = 'end', children, onClick, ...props }) => (
  <button
    type="button"
    {...props}
    data-slot="message-scroller-button"
    data-scroll-direction={direction}
    onClick={(event) => {
      onClick?.(event);
      const viewport = event.currentTarget
        .closest('[data-slot="message-scroller"]')
        ?.querySelector('[data-slot="message-scroller-viewport"]');
      if (!event.defaultPrevented && viewport)
        viewport.scrollTop = direction === 'start' ? 0 : viewport.scrollHeight;
    }}
  >
    {children ?? (direction === 'start' ? 'Scroll to start' : 'Scroll to end')}
  </button>
));
