import { direction } from './direction.js';
// Where a floating element goes next to its anchor: the side the caller asked for, flipped when it would leave
// the viewport, aligned along the other axis. Pure, so the arithmetic is unit-tested; callers apply the result.

export type PhysicalSide = 'top' | 'bottom' | 'left' | 'right';
export type Side = PhysicalSide | 'inline-start' | 'inline-end';
export type Align = 'start' | 'center' | 'end';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  /** The side used, after flipping. */
  readonly side: PhysicalSide;
}

const fits = (side: PhysicalSide, anchor: Box, floating: Box, viewport: Box, offset: number) =>
  side === 'top'
    ? anchor.y - offset - floating.height >= viewport.y
    : side === 'bottom'
      ? anchor.y + anchor.height + offset + floating.height <= viewport.y + viewport.height
      : side === 'left'
        ? anchor.x - offset - floating.width >= viewport.x
        : anchor.x + anchor.width + offset + floating.width <= viewport.x + viewport.width;

const opposite: Record<PhysicalSide, PhysicalSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

const along = (align: Align, start: number, anchorSize: number, floatingSize: number) =>
  align === 'start'
    ? start
    : align === 'end'
      ? start + anchorSize - floatingSize
      : start + (anchorSize - floatingSize) / 2;

/** Clamp a coordinate so the floating box stays inside the viewport on that axis. */
const within = (value: number, size: number, start: number, extent: number) =>
  Math.max(start, Math.min(value, start + extent - size));

/** Compute viewport placement with side flipping and cross-axis shifting. */
export interface CollisionAvoidance {
  readonly side?: 'flip' | 'shift' | 'none';
  readonly align?: 'flip' | 'shift' | 'none';
  readonly fallbackAxisSide?: 'start' | 'end' | 'none';
}

/** Resolve popup coordinates, including requested collision corrections and logical sides. */
export const place = (
  anchor: Box,
  floating: Box,
  viewport: Box,
  options: {
    readonly side?: Side;
    readonly dir?: 'ltr' | 'rtl';
    readonly align?: Align;
    readonly offset?: number;
    readonly alignOffset?: number;
    readonly collisionAvoidance?: CollisionAvoidance | undefined;
  } = {},
): Placement => {
  const rtl = options.dir === 'rtl';
  const requested = options.side ?? 'bottom';
  const wanted: PhysicalSide =
    requested === 'inline-start'
      ? rtl
        ? 'right'
        : 'left'
      : requested === 'inline-end'
        ? rtl
          ? 'left'
          : 'right'
        : requested;
  const requestedAlign = options.align ?? 'center';
  const align =
    rtl && (wanted === 'top' || wanted === 'bottom')
      ? requestedAlign === 'start'
        ? 'end'
        : requestedAlign === 'end'
          ? 'start'
          : 'center'
      : requestedAlign;
  const offset = options.offset ?? 4;
  const alignOffset =
    (options.alignOffset ?? 0) * (rtl && (wanted === 'top' || wanted === 'bottom') ? -1 : 1);
  const collision = options.collisionAvoidance;
  const sideRule = collision?.side ?? 'flip';
  const alignRule = collision?.align ?? (collision ? 'flip' : 'shift');
  let side = wanted;
  if (sideRule === 'flip' && !fits(wanted, anchor, floating, viewport, offset)) {
    if (fits(opposite[wanted], anchor, floating, viewport, offset)) side = opposite[wanted];
    else if (collision?.fallbackAxisSide && collision.fallbackAxisSide !== 'none') {
      const vertical = wanted === 'top' || wanted === 'bottom';
      const start: PhysicalSide = vertical ? (rtl ? 'right' : 'left') : 'top';
      const first = collision.fallbackAxisSide === 'start' ? start : opposite[start];
      if (fits(first, anchor, floating, viewport, offset)) side = first;
      else if (fits(opposite[first], anchor, floating, viewport, offset)) side = opposite[first];
    }
  }
  const vertical = side === 'top' || side === 'bottom';
  const crossStart = vertical ? anchor.x : anchor.y;
  const crossSize = vertical ? anchor.width : anchor.height;
  const floatingCross = vertical ? floating.width : floating.height;
  const boundaryStart = vertical ? viewport.x : viewport.y;
  const boundarySize = vertical ? viewport.width : viewport.height;
  let cross = along(align, crossStart, crossSize, floatingCross) + alignOffset;
  const fitsCross = (value: number) =>
    value >= boundaryStart && value + floatingCross <= boundaryStart + boundarySize;
  if (alignRule === 'flip' && align !== 'center' && !fitsCross(cross)) {
    const alternate =
      along(align === 'start' ? 'end' : 'start', crossStart, crossSize, floatingCross) -
      alignOffset;
    if (fitsCross(alternate)) cross = alternate;
  } else if (alignRule === 'shift')
    cross = within(cross, floatingCross, boundaryStart, boundarySize);
  let main =
    side === 'top'
      ? anchor.y - offset - floating.height
      : side === 'bottom'
        ? anchor.y + anchor.height + offset
        : side === 'left'
          ? anchor.x - offset - floating.width
          : anchor.x + anchor.width + offset;
  if (sideRule !== 'none')
    main = within(
      main,
      vertical ? floating.height : floating.width,
      vertical ? viewport.y : viewport.x,
      vertical ? viewport.height : viewport.width,
    );
  return { x: Math.round(vertical ? cross : main), y: Math.round(vertical ? main : cross), side };
};

const box = (rect: DOMRect): Box => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

/** Position a top-layer element (a popover) next to an anchor, in viewport coordinates. */
export const placeRect = (
  rect: Box,
  floating: HTMLElement,
  options: {
    readonly side?: Side;
    readonly dir?: 'ltr' | 'rtl';
    readonly align?: Align;
    readonly offset?: number;
    readonly alignOffset?: number;
    readonly collisionAvoidance?: CollisionAvoidance | undefined;
  } = {},
): Side => {
  floating.style.margin = '0';
  floating.style.inset = 'auto';
  const viewport: Box = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const result = place(rect, box(floating.getBoundingClientRect()), viewport, options);
  floating.style.position = 'fixed';
  floating.style.left = `${result.x}px`;
  floating.style.top = `${result.y}px`;
  floating.dataset.side = result.side;
  floating.dataset.align = options.align ?? 'center';
  const dimensions = floating.getBoundingClientRect();
  const availableHeight =
    result.side === 'bottom'
      ? viewport.height - result.y
      : result.side === 'top'
        ? rect.y - (options.offset ?? 4)
        : viewport.height;
  const availableWidth =
    result.side === 'right'
      ? viewport.width - result.x
      : result.side === 'left'
        ? rect.x - (options.offset ?? 4)
        : viewport.width;
  for (const [name, value] of Object.entries({
    'anchor-width': rect.width,
    'anchor-height': rect.height,
    'available-height': Math.max(0, availableHeight),
    'available-width': Math.max(0, availableWidth),
    'positioner-width': dimensions.width,
    'positioner-height': dimensions.height,
  }))
    floating.style.setProperty(`--${name}`, `${value}px`);
  floating.style.setProperty(
    '--transform-origin',
    `${Math.max(0, Math.min(dimensions.width, rect.x + rect.width / 2 - result.x))}px ${Math.max(0, Math.min(dimensions.height, rect.y + rect.height / 2 - result.y))}px`,
  );
  return result.side;
};

/** Measure a DOM anchor and apply its inherited writing direction. */
export const placeElement = (
  anchor:
    | Element
    | {
        readonly getBoundingClientRect: () => DOMRect;
        readonly contextElement?: Element | undefined;
      },
  floating: HTMLElement,
  options: Parameters<typeof placeRect>[2] = {},
): Side =>
  placeRect(anchor.getBoundingClientRect(), floating, {
    ...options,
    dir:
      options.dir ??
      direction(anchor instanceof Element ? anchor : (anchor.contextElement ?? floating)),
  });
