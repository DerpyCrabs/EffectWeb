import { composeMounts } from 'effectweb';
import { controlStyle } from './control-style.js';
import { domBinding, modelOwner, observe, view } from 'effectweb';
import type { Native } from './types.js';
// Read every dirty viewport before publishing scrollbar styles that invalidate layout.
const measurements = new WeakMap<() => void, () => (() => void) | undefined>();
const pendingMeasurements = new Set<() => void>();
let measurementFrame: number | undefined;
function scheduleMeasurement(measure: () => void) {
  pendingMeasurements.add(measure);
  if (measurementFrame !== undefined) return;
  measurementFrame = requestAnimationFrame(() => {
    measurementFrame = undefined;
    const pending = [...pendingMeasurements];
    pendingMeasurements.clear();
    const publish = pending.map((measure) => measurements.get(measure)?.());
    for (const update of publish) update?.();
  });
}
function cancelMeasurement(measure: () => void) {
  pendingMeasurements.delete(measure);
  if (!pendingMeasurements.size && measurementFrame !== undefined) {
    cancelAnimationFrame(measurementFrame);
    measurementFrame = undefined;
  }
}
export interface ScrollAreaOptions {
  readonly visibility?: 'auto' | 'always' | undefined;
  readonly mode?: 'overlay' | 'gutter' | undefined;
  readonly hideDelay?: number | undefined;
}
let scrollIds = 0;
/** Create a parent-owned scroll viewport measurement and activity handle. */
export function createScrollArea(options: ScrollAreaOptions = {}) {
  const owner = modelOwner({
    rtl: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    active: false,
  });
  let viewport: HTMLElement | undefined;
  const drags = new Map<
    HTMLElement,
    { pointer: number; start: number; scroll: number; ratio: number }
  >();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const holds = new Set<string>();
  const activity = () => {
    clearTimeout(timer);
    owner.patch({ active: true });
    if (!holds.size)
      timer = setTimeout(() => owner.patch({ active: false }), options.hideDelay ?? 700);
  };
  const capture = () => {
    if (!viewport || owner.disposed) return;
    const element = viewport;
    const snapshot = {
      rtl: getComputedStyle(viewport).direction === 'rtl',
      x: Math.abs(viewport.scrollLeft),
      y: viewport.scrollTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      scrollWidth: viewport.scrollWidth,
      scrollHeight: viewport.scrollHeight,
    };
    return () => {
      if (!owner.disposed && viewport === element) owner.patch(snapshot);
    };
  };
  const measure = () => capture()?.();
  measurements.set(measure, capture);
  owner.own(() => {
    cancelMeasurement(measure);
    measurements.delete(measure);
  });
  owner.own(() => clearTimeout(timer));
  return {
    id: `scroll-area-${++scrollIds}`,
    source: owner.source,
    lifetime: owner,
    options,
    get viewport() {
      return viewport;
    },
    attach: (element: HTMLElement | undefined) => {
      viewport = element;
      if (viewport) scheduleMeasurement(measure);
      else cancelMeasurement(measure);
    },
    measure,
    activity,
    drags,
    hold: (reason: string, active: boolean) => {
      if (active) holds.add(reason);
      else holds.delete(reason);
      activity();
    },
    scroll: (axis: 'horizontal' | 'vertical', value: number) => {
      if (!viewport) return;
      if (axis === 'vertical') viewport.scrollTop = value;
      else viewport.scrollLeft = getComputedStyle(viewport).direction === 'rtl' ? -value : value;
      measure();
      activity();
    },
  };
}
export type ScrollAreaHandle = ReturnType<typeof createScrollArea>;
export type ScrollAreaPartProps = Native<'div'> & { readonly scrollArea: ScrollAreaHandle };
const acquireViewport = (element: HTMLElement, current: () => ScrollAreaHandle) => {
  current().attach(element);
  const measure = () => current().measure();
  let disposed = false;
  const scheduleMeasure = () => {
    if (!disposed) scheduleMeasurement(current().measure);
  };
  const scroll = () => {
    measure();
    current().activity();
  };
  const resize = new ResizeObserver(scheduleMeasure);
  const children = new Set<Element>();
  const observeChildren = () => {
    for (const child of children)
      if (child.parentElement !== element) {
        resize.unobserve(child);
        children.delete(child);
      }
    for (const child of element.children)
      if (!children.has(child)) {
        children.add(child);
        resize.observe(child);
      }
  };
  const mutations = new MutationObserver((records) => {
    if (disposed) return;
    if (records.some((record) => record.type === 'childList' && record.target === element))
      observeChildren();
    scheduleMeasure();
  });
  mutations.observe(element, { childList: true, subtree: true, characterData: true });
  resize.observe(element);
  observeChildren();
  element.addEventListener('scroll', scroll);
  return {
    dispose: () => {
      disposed = true;
      cancelMeasurement(current().measure);
      resize.disconnect();
      children.clear();
      mutations.disconnect();
      element.removeEventListener('scroll', scroll);
      current().attach(undefined);
    },
  };
};
/** The scroll area container; publishes scrolling and visibility attributes. */
export const ScrollAreaRoot = view<ScrollAreaPartProps>(
  ({ scrollArea, style, onPointerEnter, onPointerLeave, onFocusIn, onFocusOut, ...rest }) =>
    observe(scrollArea.source, (state) => (
      <div
        {...rest}
        data-scrolling={state.active ? '' : undefined}
        data-mode={scrollArea.options.mode ?? 'overlay'}
        style={controlStyle(
          {
            position: 'relative',
            ...(scrollArea.options.mode === 'gutter'
              ? { paddingRight: '10px', paddingBottom: '10px' }
              : {}),
          },
          style,
        )}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (!event.defaultPrevented) scrollArea.hold('hover', true);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (event.defaultPrevented) return;
          scrollArea.hold('hover', false);
        }}
        onFocusIn={(event) => {
          onFocusIn?.(event);
          if (event.defaultPrevented) return;
          scrollArea.hold('focus', true);
        }}
        onFocusOut={(event) => {
          onFocusOut?.(event);
          if (event.defaultPrevented) return;
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            scrollArea.hold('focus', false);
        }}
      />
    )),
);
/** The natively scrolling element. */
export const ScrollAreaViewport = view<ScrollAreaPartProps>(
  ({ scrollArea, style, onKeyDown, ...rest }) => (
    <div
      {...rest}
      id={scrollArea.id}
      tabindex={rest.tabindex ?? 0}
      style={controlStyle(
        { overflow: 'auto', scrollbarWidth: 'none', height: '100%', width: '100%' },
        style,
      )}
      use={composeMounts([
        rest.use,
        { ...domBinding(scrollArea, acquireViewport), identity: scrollArea },
      ])}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.target !== event.currentTarget) return;
        const key = event.key;
        if (
          [
            'ArrowDown',
            'ArrowUp',
            'PageDown',
            'PageUp',
            'Home',
            'End',
            'ArrowLeft',
            'ArrowRight',
          ].includes(key)
        )
          scrollArea.measure();
        const state = scrollArea.source.model();
        if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(key)) {
          event.preventDefault();
          scrollArea.scroll(
            'vertical',
            key === 'Home'
              ? 0
              : key === 'End'
                ? state.scrollHeight
                : state.y +
                  (key === 'ArrowDown'
                    ? 40
                    : key === 'ArrowUp'
                      ? -40
                      : key === 'PageDown'
                        ? state.height
                        : -state.height),
          );
        }
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          event.preventDefault();
          const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
          scrollArea.scroll(
            'horizontal',
            state.x + (key === 'ArrowRight' ? 40 : -40) * (rtl ? -1 : 1),
          );
        }
      }}
    />
  ),
);
/** The measured content inside the viewport. */
export const ScrollAreaContent = view<ScrollAreaPartProps>(
  ({ scrollArea: _scrollArea, ...rest }) => <div {...rest} />,
);
type AxisProps = ScrollAreaPartProps & {
  readonly orientation?: 'horizontal' | 'vertical' | undefined;
};
type BarData = {
  readonly scrollArea: ScrollAreaHandle;
  readonly orientation: 'horizontal' | 'vertical';
};
function startBar(element: HTMLElement, event: PointerEvent, { scrollArea, orientation }: BarData) {
  scrollArea.measure();
  const state = scrollArea.source.model();
  const vertical = orientation === 'vertical';
  const rect = element.getBoundingClientRect();
  const length = vertical ? rect.height : rect.width;
  const total = vertical ? state.scrollHeight : state.scrollWidth;
  const visible = vertical ? state.height : state.width;
  const thumb = Math.max(18, (length * visible) / (total || 1));
  const ratio = (total - visible) / Math.max(1, length - thumb);
  const point = vertical ? event.clientY : event.clientX;
  const reversed = !vertical && state.rtl;
  const coordinate = point - (vertical ? rect.top : rect.left);
  if (!(event.target as Element).closest('[data-scroll-thumb]'))
    scrollArea.scroll(
      orientation,
      ((reversed ? length - coordinate : coordinate) - thumb / 2) * ratio,
    );
  scrollArea.drags.set(element, {
    pointer: event.pointerId,
    start: point,
    scroll: vertical ? scrollArea.source.model().y : scrollArea.source.model().x,
    ratio: ratio * (reversed ? -1 : 1),
  });
  scrollArea.hold('drag', true);
  element.setPointerCapture(event.pointerId);
  event.preventDefault();
}
const acquireBar = (element: HTMLElement, current: () => BarData) => ({
  dispose: () => {
    if (current().scrollArea.drags.delete(element)) current().scrollArea.hold('drag', false);
  },
});
/** A custom scrollbar for one orientation; clicks on the track scroll the viewport. */
export const ScrollAreaScrollbar = view<AxisProps>(
  ({
    scrollArea,
    orientation = 'vertical',
    style,
    onPointerDown,
    onPointerMove,
    onLostPointerCapture,
    onWheel,
    ...rest
  }) =>
    observe(scrollArea.source, (state) => {
      const vertical = orientation === 'vertical';
      const overflow = vertical
        ? state.scrollHeight > state.height
        : state.scrollWidth > state.width;
      const visible = overflow && (scrollArea.options.visibility === 'always' || state.active);
      return (
        <div
          {...rest}
          aria-hidden="true"
          data-orientation={orientation}
          data-vertical={vertical ? '' : undefined}
          data-horizontal={!vertical ? '' : undefined}
          data-visible={visible ? '' : undefined}
          data-hidden={!visible ? '' : undefined}
          style={controlStyle(
            {
              position: 'absolute',
              touchAction: 'none',
              ...(vertical
                ? { top: 0, right: 0, bottom: '10px', width: '10px' }
                : { left: 0, right: '10px', bottom: 0, height: '10px' }),
              opacity: visible ? 1 : 0,
              pointerEvents: visible ? 'auto' : 'none',
            },
            style,
          )}
          use={domBinding({ scrollArea, orientation }, acquireBar)}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            if (!event.defaultPrevented && event.button === 0)
              startBar(event.currentTarget, event, { scrollArea, orientation });
          }}
          onPointerMove={(event) => {
            onPointerMove?.(event);
            if (event.defaultPrevented) return;
            const drag = scrollArea.drags.get(event.currentTarget);
            if (!event.defaultPrevented && drag?.pointer === event.pointerId)
              scrollArea.scroll(
                orientation,
                drag.scroll +
                  ((vertical ? event.clientY : event.clientX) - drag.start) * drag.ratio,
              );
          }}
          onLostPointerCapture={(event) => {
            onLostPointerCapture?.(event);
            if (event.defaultPrevented) return;
            scrollArea.drags.delete(event.currentTarget);
            scrollArea.hold('drag', false);
          }}
          onWheel={(event) => {
            onWheel?.(event);
            if (event.defaultPrevented) return;
            const factor =
              event.deltaMode === 1
                ? 16
                : event.deltaMode === 2
                  ? vertical
                    ? state.height
                    : state.width
                  : 1;
            scrollArea.scroll(
              orientation,
              (vertical ? state.y : state.x) +
                (vertical ? event.deltaY : event.deltaX || event.deltaY) * factor,
            );
            event.preventDefault();
          }}
        />
      );
    }),
);
/** The draggable thumb of a custom scrollbar. */
export const ScrollAreaThumb = view<AxisProps>(
  ({ scrollArea, orientation = 'vertical', style, ...rest }) =>
    observe(scrollArea.source, (state) => {
      const vertical = orientation === 'vertical';
      const total = vertical ? state.scrollHeight : state.scrollWidth;
      const visible = vertical ? state.height : state.width;
      const offset = vertical ? state.y : state.x;
      const size = Math.min(100, (visible / (total || 1)) * 100);
      const fraction = offset / (total - visible || 1);
      const progress = !vertical && state.rtl ? 1 - fraction : fraction;
      return (
        <div
          {...rest}
          data-scroll-thumb=""
          style={controlStyle(
            {
              position: 'absolute',
              ...(vertical
                ? {
                    width: '100%',
                    height: `max(18px, ${size}%)`,
                    top: `${progress * 100}%`,
                    transform: `translateY(-${progress * 100}%)`,
                  }
                : {
                    height: '100%',
                    width: `max(18px, ${size}%)`,
                    left: `${progress * 100}%`,
                    transform: `translateX(-${progress * 100}%)`,
                  }),
            },
            style,
          )}
        />
      );
    }),
);
/** The corner between two scrollbars. */
export const ScrollAreaCorner = view<ScrollAreaPartProps>(({ scrollArea, style, ...rest }) =>
  observe(scrollArea.source, (state) => (
    <div
      {...rest}
      aria-hidden="true"
      hidden={state.scrollWidth <= state.width || state.scrollHeight <= state.height}
      style={controlStyle(
        { position: 'absolute', bottom: 0, right: 0, width: '10px', height: '10px' },
        style,
      )}
    />
  )),
);
