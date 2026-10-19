import { expect, it } from 'vitest';
import { place } from './positioning.js';
const anchor = { x: 90, y: 90, width: 10, height: 10 };
const popup = { x: 0, y: 0, width: 30, height: 20 };
const viewport = { x: 0, y: 0, width: 100, height: 100 };
it('keeps the chosen side and shifts for a details card instead of flipping above its anchor', () => {
  expect(
    place(anchor, popup, viewport, {
      side: 'bottom',
      align: 'start',
      collisionAvoidance: { side: 'shift', align: 'shift', fallbackAxisSide: 'none' },
    }),
  ).toEqual({ x: 70, y: 80, side: 'bottom' });
});
it('honors disabled overflow correction on each axis', () => {
  expect(
    place(anchor, popup, viewport, {
      side: 'bottom',
      align: 'start',
      collisionAvoidance: { side: 'none', align: 'none' },
    }),
  ).toEqual({ x: 90, y: 104, side: 'bottom' });
});
it('flips alignment to the other edge when it fits', () => {
  expect(
    place(anchor, popup, viewport, {
      side: 'top',
      align: 'start',
      collisionAvoidance: { side: 'flip', align: 'flip' },
    }),
  ).toEqual({ x: 70, y: 66, side: 'top' });
});
it('uses the requested perpendicular fallback only when neither preferred side fits', () => {
  expect(
    place(
      { x: 40, y: 40, width: 10, height: 10 },
      { x: 0, y: 0, width: 20, height: 70 },
      viewport,
      {
        side: 'bottom',
        collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'start' },
      },
    ),
  ).toEqual({ x: 16, y: 10, side: 'left' });
});
