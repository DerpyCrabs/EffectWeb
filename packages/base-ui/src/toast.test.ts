import { describe, expect, it, vi } from 'vite-plus/test';
import { createToastManager } from './toast.js';

describe('toast updates', () => {
  it('updates an existing notification and resets its timeout without dropping custom data', () => {
    vi.useFakeTimers();
    const manager = createToastManager<{ thread: string }>({ timeout: 1000 });
    const id = manager.add({ id: 'status', title: 'Starting', data: { thread: 'one' } });
    vi.advanceTimersByTime(900);
    manager.update(id, { title: 'Ready', timeout: 2000, data: undefined });
    expect(manager.source.model().toasts[0]).toMatchObject({
      title: 'Ready',
      data: { thread: 'one' },
    });
    vi.advanceTimersByTime(1999);
    expect(manager.source.model().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.source.model().toasts).toHaveLength(0);
    manager.lifetime.dispose();
    vi.useRealTimers();
  });
  it('upserts queued data and invokes close/removal once after the exit finishes', () => {
    const manager = createToastManager({ limit: 1 });
    const onClose = vi.fn(),
      onRemove = vi.fn();
    const first = manager.add({ title: 'First', timeout: 0, onClose, onRemove });
    manager.add({ id: 'queued', title: 'Old', timeout: 0 });
    manager.add({ id: 'queued', title: 'New' });
    let finish: (() => void) | undefined;
    const stop = manager.attach(first, (done) => {
      finish = done;
    });
    manager.close(first);
    manager.close(first);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
    finish!();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(manager.source.model().toasts[0]?.title).toBe('New');
    stop();
    manager.close();
    manager.lifetime.dispose();
  });
  it('allows a close callback to close notifications without reentering itself', () => {
    const manager = createToastManager({ timeout: 0 });
    const onClose = vi.fn(() => manager.close());
    manager.add({ title: 'First', onClose });
    manager.add({ title: 'Second' });
    manager.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(manager.source.model().toasts).toHaveLength(0);
    manager.lifetime.dispose();
  });
});

it('refreshes an existing toast with its full timeout when add omits timeout', () => {
  vi.useFakeTimers();
  const manager = createToastManager({ timeout: 1000 });
  try {
    manager.add({ id: 'status', title: 'Starting', timeout: 2000 });
    vi.advanceTimersByTime(1900);
    manager.add({ id: 'status', title: 'Ready' });
    vi.advanceTimersByTime(1999);
    expect(manager.source.model().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.source.model().toasts).toHaveLength(0);
  } finally {
    manager.lifetime.dispose();
    vi.useRealTimers();
  }
});
it('refreshes paused toasts without starting the timer until every pause is released', () => {
  vi.useFakeTimers();
  const manager = createToastManager({ timeout: 1000 });
  try {
    manager.add({ id: 'status', title: 'Starting' });
    vi.advanceTimersByTime(900);
    manager.pause('hover');
    manager.pause('focus');
    manager.add({ id: 'status', title: 'Ready' });
    vi.advanceTimersByTime(5000);
    manager.resume('hover');
    vi.advanceTimersByTime(5000);
    expect(manager.source.model().toasts).toHaveLength(1);
    manager.resume('focus');
    vi.advanceTimersByTime(999);
    expect(manager.source.model().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.source.model().toasts).toHaveLength(0);
  } finally {
    manager.lifetime.dispose();
    vi.useRealTimers();
  }
});
it('starts an upserted queued toast timeout only on promotion', () => {
  vi.useFakeTimers();
  const manager = createToastManager({ limit: 1, timeout: 1000 });
  try {
    const first = manager.add({ title: 'First', timeout: 0 });
    manager.add({ id: 'queued', title: 'Queued' });
    vi.advanceTimersByTime(900);
    manager.add({ id: 'queued', title: 'Ready' });
    vi.advanceTimersByTime(5000);
    manager.close(first);
    expect(manager.source.model().toasts[0]?.title).toBe('Ready');
    vi.advanceTimersByTime(999);
    expect(manager.source.model().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(manager.source.model().toasts).toHaveLength(0);
  } finally {
    manager.lifetime.dispose();
    vi.useRealTimers();
  }
});
