import { describe, expect, it, vi } from 'vitest';
import { formatNumber, parseNumber, snapNumber } from './numeric.js';
import { createSlider } from './slider.js';
import { createNumberField } from './number-field.js';
import { createToastManager } from './toast.js';
describe('numeric controls', () => {
  it('steps decimal values relative to min and clamps bounds', () => {
    expect(snapNumber(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    expect(snapNumber(0.39, 0.05, 1, 0.1)).toBe(0.35);
    expect(snapNumber(-20, 0, 10, 1)).toBe(0);
    expect(snapNumber(20, 0, 10, 1)).toBe(10);
  });
  it('round-trips decimal, localized digits, currency, accounting and percent', () => {
    for (const locale of ['en-US', 'de-DE', 'fr-FR', 'ar-EG']) {
      for (const format of [
        {},
        { style: 'currency', currency: 'EUR' },
        { style: 'currency', currency: 'USD', currencySign: 'accounting' },
        { style: 'percent', maximumFractionDigits: 3 },
      ] as const) {
        expect(parseNumber(formatNumber(-1234.5, locale, format), locale, format)).toBe(-1234.5);
      }
    }
    expect(parseNumber('12cats')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
  it('requests controlled changes and synchronizes without callback loops', () => {
    const changed = vi.fn();
    const field = createNumberField({ value: 5, onValueChange: changed });
    field.step(1);
    expect(changed).toHaveBeenCalledWith(6);
    expect(field.source.model().value).toBe(5);
    field.sync({ value: 6, onValueChange: changed });
    expect(field.source.model().value).toBe(6);
    expect(changed).toHaveBeenCalledTimes(1);
    field.lifetime.dispose();
  });
  it('prevents range thumbs crossing and ignores disabled steps', () => {
    const slider = createSlider({ defaultValues: [20, 80], step: 5 });
    slider.set(0, 95);
    expect(slider.source.model().values).toEqual([80, 80]);
    slider.sync({ disabled: true });
    slider.set(0, 0);
    expect(slider.source.model().values).toEqual([80, 80]);
    slider.lifetime.dispose();
  });
});
describe('toast timing', () => {
  it('starts queued timeouts on promotion and supports overlapping pause reasons', () => {
    vi.useFakeTimers();
    const manager = createToastManager({ limit: 1, timeout: 1000 });
    const first = manager.add({ title: 'First' });
    manager.add({ title: 'Second' });
    vi.advanceTimersByTime(400);
    manager.pause('hover');
    manager.pause('focus');
    vi.advanceTimersByTime(2000);
    manager.resume('hover');
    vi.advanceTimersByTime(2000);
    expect(manager.source.model().toasts[0]?.id).toBe(first);
    manager.resume('focus');
    vi.advanceTimersByTime(599);
    expect(manager.source.model().toasts[0]?.id).toBe(first);
    vi.advanceTimersByTime(1);
    expect(manager.source.model().toasts[0]?.title).toBe('Second');
    vi.advanceTimersByTime(999);
    expect(manager.source.model().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.source.model().toasts).toHaveLength(0);
    manager.lifetime.dispose();
    vi.useRealTimers();
  });
  it('keeps persistent notifications, removes queued entries and cleans up timers', () => {
    vi.useFakeTimers();
    const manager = createToastManager({ limit: 1 });
    manager.add({ title: 'Persistent', timeout: 0 });
    const queued = manager.add({ title: 'Queued' });
    manager.close(queued);
    vi.advanceTimersByTime(100000);
    expect(manager.source.model().toasts).toHaveLength(1);
    expect(manager.source.model().queued).toHaveLength(0);
    manager.lifetime.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
