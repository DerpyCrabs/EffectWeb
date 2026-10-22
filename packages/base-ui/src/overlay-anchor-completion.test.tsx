// @vitest-environment happy-dom
import { view as bindingView, type DomMount } from 'effectweb';
import { renderView } from 'effectweb/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { createOverlay, popupBinding, type PositionOptions } from './overlay.js';
import { createPresence } from './presence.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanups.splice(0).reverse()) stop();
  document.body.replaceChildren();
  vi.useRealTimers();
});
it('positions a virtual anchor without replacing the focus-restoration trigger', async () => {
  const trigger = document.createElement('button'),
    popup = document.createElement('div');
  popup.tabIndex = -1;
  document.body.append(trigger, popup);
  let open = false;
  popup.showPopover = () => {
    open = true;
  };
  popup.hidePopover = () => {
    open = false;
  };
  Object.defineProperty(popup, 'matches', {
    value: (selector: string) => selector === ':popover-open' && open,
  });
  popup.getAnimations = () => [];
  popup.getBoundingClientRect = () => new DOMRect(0, 0, 100, 50);
  const handle = createOverlay();
  handle.attachTrigger(trigger);
  let anchor: PositionOptions['anchor'] = {
    getBoundingClientRect: () => new DOMRect(200, 150, 0, 0),
  };
  const input = () => ({
    handle,
    kind: 'menu' as const,
    anchor,
    side: 'bottom' as const,
    align: 'start' as const,
    sideOffset: 0,
  });
  const work = await mountTestBinding(popup, popupBinding(input()));
  cleanups.push(() => {
    work.dispose();
    handle.lifetime.dispose();
  });
  handle.setOpen(true);
  expect(popup.style.left).toBe('200px');
  expect(popup.style.top).toBe('150px');
  expect(handle.trigger()).toBe(trigger);
  anchor = () => ({ getBoundingClientRect: () => new DOMRect(310, 220, 0, 0) });
  work.update(popupBinding(input()));
  expect(popup.style.left).toBe('310px');
  expect(popup.style.top).toBe('220px');
  handle.hide();
  expect(document.activeElement).toBe(trigger);
});
it('reports completed transitions, cancels interrupted exits and never completes after disposal', async () => {
  vi.useFakeTimers();
  const element = document.createElement('div');
  document.body.append(element);
  element.getAnimations = () => [];
  const presence = createPresence(element),
    show = vi.fn(),
    hide = vi.fn(),
    complete = vi.fn();
  cleanups.push(presence.dispose);
  presence.update(false, show, hide, complete);
  expect(complete).not.toHaveBeenCalled();
  presence.update(true, show, hide, complete);
  await vi.runAllTimersAsync();
  expect(complete).toHaveBeenLastCalledWith(true);
  let finish!: () => void;
  element.getAnimations = () =>
    [
      {
        playState: 'running',
        effect: { getComputedTiming: () => ({ endTime: 100 }) },
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      },
    ] as unknown as Animation[];
  presence.update(false, show, hide, complete);
  expect(complete).toHaveBeenCalledTimes(1);
  presence.update(true, show, hide, complete);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).toHaveBeenCalledTimes(1);
  presence.dispose();
  await vi.runAllTimersAsync();
  expect(complete).toHaveBeenCalledTimes(1);
});
it('calls the overlay completion callback after close so a host can advance its queue', async () => {
  const popup = document.createElement('div');
  document.body.append(popup);
  let open = false;
  popup.showPopover = () => {
    open = true;
  };
  popup.hidePopover = () => {
    open = false;
  };
  Object.defineProperty(popup, 'matches', {
    value: (selector: string) => selector === ':popover-open' && open,
  });
  popup.getAnimations = () => [];
  const complete = vi.fn(),
    handle = createOverlay({ onOpenChangeComplete: complete });
  const input = { handle, kind: 'popover' as const };
  const work = await mountTestBinding(popup, popupBinding(input));
  cleanups.push(() => {
    work.dispose();
    handle.lifetime.dispose();
  });
  handle.setOpen(true);
  handle.hide();
  expect(open).toBe(false);
  expect(complete).toHaveBeenCalledExactlyOnceWith(false);
});
it('keeps initially closed popups out of layout despite author display and preserves display across exit and reopen', async () => {
  const popup = document.createElement('div');
  popup.style.display = 'flex';
  document.body.append(popup);
  let nativeOpen = false;
  popup.showPopover = () => {
    nativeOpen = true;
  };
  popup.hidePopover = () => {
    nativeOpen = false;
  };
  Object.defineProperty(popup, 'matches', {
    value: (selector: string) => selector === ':popover-open' && nativeOpen,
  });
  popup.getAnimations = () => [];
  const handle = createOverlay(),
    input = { handle, kind: 'popover' as const };
  const work = await mountTestBinding(popup, popupBinding(input));
  if (!work || typeof work !== 'object' || !('dispose' in work)) throw Error('Expected lifetime');
  cleanups.push(() => {
    work.dispose();
    handle.lifetime.dispose();
  });
  expect(popup.hasAttribute('data-closed')).toBe(true);
  expect(popup.style.getPropertyValue('display')).toBe('none');
  expect(popup.style.getPropertyPriority('display')).toBe('important');
  handle.setOpen(true);
  expect(nativeOpen).toBe(true);
  expect(popup.style.display).toBe('flex');
  let finish!: () => void;
  popup.getAnimations = () =>
    [
      {
        playState: 'running',
        effect: { getComputedTiming: () => ({ endTime: 100 }) },
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      },
    ] as unknown as Animation[];
  handle.hide();
  expect(nativeOpen).toBe(true);
  expect(popup.style.display).toBe('flex');
  finish();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(nativeOpen).toBe(false);
  expect(popup.style.display).toBe('none');
  handle.setOpen(true);
  expect(popup.style.display).toBe('flex');
});
it('restores author style when a closed popup binding is released', async () => {
  const popup = document.createElement('div');
  popup.style.setProperty('display', 'grid', 'important');
  document.body.append(popup);
  Object.defineProperty(popup, 'matches', { value: () => false });
  popup.getAnimations = () => [];
  const handle = createOverlay(),
    input = { handle, kind: 'tooltip' as const };
  const work = await mountTestBinding(popup, popupBinding(input));
  if (!work || typeof work !== 'object' || !('dispose' in work)) throw Error('Expected lifetime');
  expect(popup.style.display).toBe('none');
  work.dispose();
  handle.lifetime.dispose();
  expect(popup.style.display).toBe('grid');
  expect(popup.style.getPropertyPriority('display')).toBe('important');
});

it('reports an asynchronous completion failure through the element window', async () => {
  const element = document.createElement('div');
  const failure = new Error('completion failed');
  let finish!: () => void;
  const motion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  element.getAnimations = () =>
    [
      {
        playState: 'running',
        effect: { getComputedTiming: () => ({ endTime: 100 }) },
        finished: motion,
      },
    ] as unknown as Animation[];
  const reported = new Promise<unknown>((resolve) => {
    vi.stubGlobal('reportError', resolve);
  });
  const presence = createPresence(element);
  try {
    presence.update(
      true,
      () => {},
      () => {},
    );
    presence.update(
      false,
      () => {},
      () => {},
      () => {
        throw failure;
      },
    );
    finish();
    expect(await reported).toBe(failure);
  } finally {
    presence.dispose();
    vi.unstubAllGlobals();
  }
});

/** Keep the preconfigured test target while running its binding through a real use lifetime. */
async function mountTestBinding<T extends Element>(element: T, binding: DomMount<T>) {
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const target = bindingView<DomMount<T>>((current) => (
    <span
      use={{
        ...current,
        acquire: (
          _host: Element,
          input: () => unknown,
          lifetime: Parameters<DomMount<T>['acquire']>[2],
        ) => {
          const work = current.acquire(element, input, lifetime);
          acquired();
          return work;
        },
      }}
    />
  ));
  const rendered = renderView(document.createElement('div'), target, binding);
  await ready;
  return rendered;
}
