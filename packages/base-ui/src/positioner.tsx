import { domBinding, view } from 'effectweb';
import { resolvePositionAnchor } from './position-anchor.js';
import { placeElement } from './positioning.js';
import type { OverlayHandle, PositionOptions } from './overlay.js';
import type { Native } from './types.js';
interface PositionerInput extends PositionOptions {
  readonly handle: OverlayHandle;
}
const positionerBinding = (input: PositionerInput) =>
  domBinding(input, (element: HTMLElement, current) => {
    const sync = () => {
      const {
        handle,
        anchor: suppliedAnchor,
        side,
        align,
        sideOffset,
        alignOffset,
        collisionAvoidance,
      } = current();
      handle.configurePosition({
        anchor: suppliedAnchor,
        side,
        align,
        sideOffset,
        alignOffset,
        collisionAvoidance,
      });
      const popup = handle.popup();
      const anchor = resolvePositionAnchor(suppliedAnchor, handle.trigger());
      if (!popup || !anchor || !handle.source.model().open) return;
      placeElement(anchor, popup, {
        side: side ?? 'bottom',
        align: align ?? 'center',
        offset: sideOffset ?? 4,
        alignOffset: alignOffset ?? 0,
        collisionAvoidance,
      });
      element.dataset.side = popup.dataset.side;
      element.dataset.align = popup.dataset.align;
      for (const name of [
        'anchor-width',
        'anchor-height',
        'available-width',
        'available-height',
        'positioner-width',
        'positioner-height',
        'transform-origin',
      ])
        element.style.setProperty(`--${name}`, popup.style.getPropertyValue(`--${name}`));
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    const stop = current().handle.source.subscribe(() => queueMicrotask(sync));
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    queueMicrotask(sync);
    return {
      update: sync,
      dispose: () => {
        stop();
        current().handle.configurePosition(undefined);
        observer.disconnect();
        window.removeEventListener('resize', sync);
        window.removeEventListener('scroll', sync, true);
      },
    };
  });
/** Positions a popup against an anchor with side, alignment and offsets; flips and shifts inside the viewport. */
export const Positioner = view<Native<'div'> & PositionerInput>(
  ({ handle, anchor, side, align, sideOffset, alignOffset, collisionAvoidance, ...rest }) => (
    <div
      {...rest}
      use={positionerBinding({
        handle,
        anchor,
        side,
        align,
        sideOffset,
        alignOffset,
        collisionAvoidance,
      })}
    />
  ),
);
const arrowBinding = (handle: OverlayHandle) =>
  domBinding(handle, (element: HTMLElement, current) => {
    const sync = () => {
      const popup = current().popup();
      const anchor = resolvePositionAnchor(current().position()?.anchor, current().trigger());
      if (!popup || !anchor) return;
      const box = popup.getBoundingClientRect();
      const target = anchor.getBoundingClientRect();
      const side = popup.dataset.side ?? 'bottom';
      const vertical = side === 'top' || side === 'bottom';
      element.style.position = 'absolute';
      element.dataset.side = side;
      element.style.left = vertical
        ? `${Math.max(0, Math.min(box.width - element.offsetWidth, target.x + target.width / 2 - box.x - element.offsetWidth / 2))}px`
        : side === 'right'
          ? '0px'
          : '100%';
      element.style.top = !vertical
        ? `${Math.max(0, Math.min(box.height - element.offsetHeight, target.y + target.height / 2 - box.y - element.offsetHeight / 2))}px`
        : side === 'bottom'
          ? '0px'
          : '100%';
    };
    const observer = new ResizeObserver(sync);
    if (current().popup()) observer.observe(current().popup()!);
    const stop = current().source.subscribe(() => queueMicrotask(sync));
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    queueMicrotask(sync);
    return {
      update: sync,
      dispose: () => {
        observer.disconnect();
        stop();
        window.removeEventListener('scroll', sync, true);
        window.removeEventListener('resize', sync);
      },
    };
  });
/** An arrow element aligned to the anchor center within a positioned popup. */
export const Arrow = view<Native<'span'> & { readonly handle: OverlayHandle }>(
  ({ handle, ...rest }) => <span {...rest} aria-hidden="true" use={arrowBinding(handle)} />,
);
