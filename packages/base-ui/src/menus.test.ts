import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContextMenu } from './context-menu.js';
import { createMenubar } from './menubar.js';
import { createNavigationMenu } from './navigation-menu.js';

afterEach(() => vi.useRealTimers());
describe('menu family handles', () => {
  it('context anchors are geometric and controlled opening waits for synchronization', () => {
    const changes: boolean[] = [];
    const menu = createContextMenu({ open: false, onOpenChange: (value) => changes.push(value) });
    menu.openAt(123, 456);
    expect(menu.anchor()?.getBoundingClientRect()).toEqual({ x: 123, y: 456, width: 0, height: 0 });
    expect(menu.trigger()).toBeUndefined();
    expect(menu.source.model().open).toBe(false);
    expect(changes).toEqual([true]);
    menu.sync({ open: true });
    expect(menu.source.model().open).toBe(true);
    menu.lifetime.dispose();
  });
  it('menubar opens one menu and recursively closes its interaction tree', () => {
    const bar = createMenubar();
    const first = bar.createMenu();
    const second = bar.createMenu();
    vi.useFakeTimers();
    const child = createContextMenu({ parent: first, delay: 100 });
    bar.open(first);
    child.showDelayed();
    bar.open(second);
    vi.advanceTimersByTime(100);
    expect(first.source.model().open).toBe(false);
    expect(child.source.model().open).toBe(false);
    expect(second.source.model().open).toBe(true);
    child.lifetime.dispose();
    bar.lifetime.dispose();
  });
  it('navigation cancels obsolete hover requests and cleans up timers with its owner', () => {
    vi.useFakeTimers();
    const menu = createNavigationMenu({ delay: 200, closeDelay: 150 });
    menu.schedule('learn');
    vi.advanceTimersByTime(199);
    expect(menu.source.model().value).toBe('');
    menu.schedule('tools');
    vi.advanceTimersByTime(200);
    expect(menu.source.model().value).toBe('tools');
    menu.schedule('');
    menu.cancel();
    vi.advanceTimersByTime(200);
    expect(menu.source.model().value).toBe('tools');
    menu.schedule('');
    vi.advanceTimersByTime(150);
    expect(menu.source.model().value).toBe('');
    menu.schedule('learn');
    menu.lifetime.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('navigation controlled values request changes and disabled values ignore them', () => {
    const changes: string[] = [];
    const menu = createNavigationMenu({ value: '', onValueChange: (value) => changes.push(value) });
    menu.show('learn');
    expect(menu.source.model().value).toBe('');
    expect(changes).toEqual(['learn']);
    menu.sync({ value: 'learn', disabled: true });
    menu.show('tools');
    expect(menu.source.model().value).toBe('learn');
    expect(changes).toEqual(['learn']);
    menu.lifetime.dispose();
  });
});
