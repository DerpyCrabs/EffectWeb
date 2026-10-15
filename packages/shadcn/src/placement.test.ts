import { describe, expect, it } from 'vitest';
import { place } from './placement.js';

const viewport = { x: 0, y: 0, width: 1000, height: 800 };
const anchor = { x: 400, y: 300, width: 100, height: 40 };
const floating = { x: 0, y: 0, width: 200, height: 100 };

describe('place', () => {
  it('sits below the anchor, centred, four pixels away by default', () => {
    expect(place(anchor, floating, viewport)).toEqual({ x: 350, y: 344, side: 'bottom' });
  });
  it('aligns to the start or end edge and honours an offset', () => {
    expect(place(anchor, floating, viewport, { align: 'start', offset: 8 })).toEqual({
      x: 400,
      y: 348,
      side: 'bottom',
    });
    expect(place(anchor, floating, viewport, { align: 'end', side: 'top' })).toEqual({
      x: 300,
      y: 196,
      side: 'top',
    });
  });
  it('flips to the other side when the wanted side would leave the viewport', () => {
    expect(place({ ...anchor, y: 740 }, floating, viewport).side).toBe('top');
    expect(place({ ...anchor, y: 20 }, floating, viewport, { side: 'top' }).side).toBe('bottom');
    expect(place({ ...anchor, x: 950 }, floating, viewport, { side: 'right' }).side).toBe('left');
  });
  it('keeps the wanted side when neither side fits', () => {
    expect(place(anchor, { ...floating, height: 2000 }, viewport).side).toBe('bottom');
  });
  it('clamps the aligned axis inside the viewport', () => {
    expect(place({ ...anchor, x: 950 }, floating, viewport).x).toBe(800);
    expect(place({ ...anchor, x: -50 }, floating, viewport).x).toBe(0);
    expect(place({ ...anchor, y: 790 }, floating, viewport, { side: 'right' }).y).toBe(700);
  });
});
