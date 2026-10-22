import ArrowLeft from '@effectweb/lucide/icons/arrow-left';
import ArrowRight from '@effectweb/lucide/icons/arrow-right';
import { domBinding, modelOwner, observe, view } from 'effectweb';
import { Button, type ButtonProps } from './button.js';
import { cn } from './cn.js';
import type { Native, Styled } from './types.js';

export interface CarouselOptions {
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
  /** Wrap from the last slide to the first. */
  readonly loop?: boolean | undefined;
  readonly onSelect?: ((index: number) => void) | undefined;
}
export interface CarouselState {
  readonly orientation: 'horizontal' | 'vertical';
  readonly index: number;
  readonly count: number;
  readonly canScrollPrev: boolean;
  readonly canScrollNext: boolean;
}
/** Create a parent-owned Carousel handle; the content, slides and buttons share it. */
export function createCarousel(options: CarouselOptions = {}) {
  const owner = modelOwner<CarouselState>({
    orientation: options.orientation ?? 'horizontal',
    index: 0,
    count: 0,
    canScrollPrev: false,
    canScrollNext: false,
  });
  let viewport: HTMLElement | undefined;
  const publish = (index: number, count: number) => {
    const loop = options.loop ?? false;
    const previous = owner.read();
    owner.patch({
      index,
      count,
      canScrollPrev: loop ? count > 1 : index > 0,
      canScrollNext: loop ? count > 1 : index < count - 1,
    });
    if (previous.index !== index) options.onSelect?.(index);
  };
  const slides = () =>
    viewport ? [...viewport.querySelectorAll<HTMLElement>('[data-slot=carousel-item]')] : [];
  const scrollTo = (index: number, smooth = true) => {
    const items = slides();
    const count = items.length;
    if (!viewport || !count) return;
    const target = options.loop
      ? ((index % count) + count) % count
      : Math.max(0, Math.min(count - 1, index));
    const slide = items[target]!;
    const vertical = owner.read().orientation === 'vertical';
    viewport.scrollTo({
      [vertical ? 'top' : 'left']: vertical ? slide.offsetTop : slide.offsetLeft,
      behavior: smooth ? 'smooth' : 'auto',
    });
    publish(target, count);
  };
  return {
    source: owner.source,
    lifetime: owner,
    scrollTo,
    scrollPrev: () => scrollTo(owner.read().index - 1),
    scrollNext: () => scrollTo(owner.read().index + 1),
    /** Internal: adopt the scrolling element and follow its scroll position. */
    attach(element: HTMLElement) {
      viewport = element;
      const sync = () => {
        const items = slides();
        const vertical = owner.read().orientation === 'vertical';
        const position = vertical ? element.scrollTop : element.scrollLeft;
        let nearest = 0;
        let distance = Infinity;
        items.forEach((slide, index) => {
          const offset = Math.abs((vertical ? slide.offsetTop : slide.offsetLeft) - position);
          if (offset < distance) {
            distance = offset;
            nearest = index;
          }
        });
        publish(nearest, items.length);
      };
      element.addEventListener('scroll', sync, { passive: true });
      const resize = new ResizeObserver(sync);
      resize.observe(element);
      const changes = new MutationObserver(sync);
      changes.observe(element, { childList: true, subtree: true });
      sync();
      return () => {
        element.removeEventListener('scroll', sync);
        resize.disconnect();
        changes.disconnect();
        if (viewport === element) viewport = undefined;
      };
    },
  };
}
export type CarouselHandle = ReturnType<typeof createCarousel>;
/** The carousel region; arrow keys move between slides. */
export const Carousel = view<Native<'div'> & Styled & { readonly carousel: CarouselHandle }>(
  ({ carousel, class: className, children, onKeyDown, ...rest }) => (
    <div
      role="region"
      aria-roledescription="carousel"
      data-slot="carousel"
      class={cn('relative', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const vertical = carousel.source.model().orientation === 'vertical';
        if (event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) {
          event.preventDefault();
          carousel.scrollPrev();
        } else if (event.key === (vertical ? 'ArrowDown' : 'ArrowRight')) {
          event.preventDefault();
          carousel.scrollNext();
        }
      }}
      {...rest}
    >
      {children}
    </div>
  ),
);
const acquireViewport = (element: HTMLElement, current: () => CarouselHandle) =>
  current().attach(element);
/** The scrolling viewport of the slides, snapping to each one. */
export const CarouselContent = view<Native<'div'> & Styled & { readonly carousel: CarouselHandle }>(
  ({ carousel, class: className, children, ...rest }) =>
    observe(carousel.source, (state) => (
      <div
        data-slot="carousel-content"
        class="overflow-hidden"
        use={domBinding(carousel, acquireViewport)}
        style={{
          overflow: 'auto',
          scrollSnapType: state.orientation === 'horizontal' ? 'x mandatory' : 'y mandatory',
          scrollbarWidth: 'none',
        }}
      >
        <div
          class={cn(
            'flex',
            state.orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col',
            className,
          )}
          {...rest}
        >
          {children}
        </div>
      </div>
    )),
);
/** One slide. */
export const CarouselItem = view<Native<'div'> & Styled & { readonly carousel: CarouselHandle }>(
  ({ carousel, class: className, children, ...rest }) =>
    observe(carousel.source, (state) => (
      <div
        role="group"
        aria-roledescription="slide"
        data-slot="carousel-item"
        class={cn(
          'min-w-0 shrink-0 grow-0 basis-full',
          state.orientation === 'horizontal' ? 'pl-4' : 'pt-4',
          className,
        )}
        style={{ scrollSnapAlign: 'start' }}
        {...rest}
      >
        {children}
      </div>
    )),
);
/** Scrolls to the previous slide. */
export const CarouselPrevious = view<ButtonProps & { readonly carousel: CarouselHandle }>(
  ({ carousel, class: className, variant, size, onClick, ...rest }) =>
    observe(carousel.source, (state) => (
      <Button
        data-slot="carousel-previous"
        variant={variant ?? 'outline'}
        size={size ?? 'icon'}
        class={cn(
          'absolute size-8 rounded-full',
          state.orientation === 'horizontal'
            ? 'top-1/2 -left-12 -translate-y-1/2'
            : '-top-12 left-1/2 -translate-x-1/2 rotate-90',
          className,
        )}
        disabled={!state.canScrollPrev}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) carousel.scrollPrev();
        }}
        {...rest}
      >
        <ArrowLeft />
        <span class="sr-only">Previous slide</span>
      </Button>
    )),
);
/** Scrolls to the next slide. */
export const CarouselNext = view<ButtonProps & { readonly carousel: CarouselHandle }>(
  ({ carousel, class: className, variant, size, onClick, ...rest }) =>
    observe(carousel.source, (state) => (
      <Button
        data-slot="carousel-next"
        variant={variant ?? 'outline'}
        size={size ?? 'icon'}
        class={cn(
          'absolute size-8 rounded-full',
          state.orientation === 'horizontal'
            ? 'top-1/2 -right-12 -translate-y-1/2'
            : '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
          className,
        )}
        disabled={!state.canScrollNext}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) carousel.scrollNext();
        }}
        {...rest}
      >
        <ArrowRight />
        <span class="sr-only">Next slide</span>
      </Button>
    )),
);
