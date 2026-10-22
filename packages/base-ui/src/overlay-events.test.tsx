// @vitest-environment happy-dom
import { view as bindingView, type DomMount } from 'effectweb';
import { renderView } from 'effectweb/testing';
import { mount, view } from 'effectweb';
import { afterEach, expect, it, vi } from 'vitest';
import { createOverlay, popupBinding, type OverlayChangeEventDetails } from './overlay.js';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  document.body.replaceChildren();
});
async function fixture(onOpenChange?: (open: boolean, details: OverlayChangeEventDetails) => void) {
  const handle = createOverlay({ onOpenChange });
  const trigger = document.createElement('button');
  const element = document.createElement('div');
  const outside = document.createElement('input');
  document.body.append(trigger, element, outside);
  element.tabIndex = -1;
  let shown = false;
  element.showPopover = () => {
    shown = true;
  };
  element.hidePopover = () => {
    shown = false;
  };
  Object.defineProperty(element, 'matches', {
    value: (selector: string) => selector === ':popover-open' && shown,
  });
  element.getAnimations = () => [];
  handle.attachTrigger(trigger);
  const input = { handle, kind: 'popover' as const };
  const binding = await mountTestBinding(element, popupBinding(input));
  cleanup.push(() => {
    binding.dispose();
    handle.lifetime.dispose();
  });
  return { handle, element, outside, trigger };
}
it('lets the owner cancel outside press and focus-out without publishing a closed state', async () => {
  const changes: OverlayChangeEventDetails[] = [];
  const p = await fixture((open, details) => {
    changes.push(details);
    if (!open && (details.reason === 'outside-press' || details.reason === 'focus-out'))
      details.cancel();
  });
  p.handle.setOpen(true);
  const published = vi.fn();
  cleanup.push(p.handle.source.subscribe(published));
  const pointer = new PointerEvent('pointerdown', { bubbles: true });
  p.outside.dispatchEvent(pointer);
  expect(changes.at(-1)).toMatchObject({
    reason: 'outside-press',
    event: pointer,
    trigger: p.trigger,
    isCanceled: true,
  });
  p.element.dispatchEvent(new FocusEvent('focusout', { relatedTarget: p.outside, bubbles: true }));
  expect(changes.at(-1)?.reason).toBe('focus-out');
  expect(p.handle.source.model().open).toBe(true);
  expect(published).not.toHaveBeenCalled();
});
it('uses the Escape event and allows its propagation when requested', async () => {
  const p = await fixture((_open, details) => {
    if (details.reason === 'escape-key') details.allowPropagation();
  });
  p.handle.setOpen(true);
  const listener = vi.fn();
  document.addEventListener('keydown', listener);
  cleanup.push(() => document.removeEventListener('keydown', listener));
  p.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  expect(p.handle.source.model().open).toBe(false);
  expect(listener).toHaveBeenCalledTimes(1);
});
it('controlled requests wait for synchronization, and uncontrolled cancellation precedes state changes', () => {
  const request = vi.fn();
  const controlled = createOverlay({ open: false, onOpenChange: request });
  controlled.setOpen(true);
  expect(controlled.source.model().open).toBe(false);
  expect(request).toHaveBeenCalledWith(
    true,
    expect.objectContaining({ reason: 'imperative-action' }),
  );
  controlled.sync({ open: true });
  expect(controlled.source.model().open).toBe(true);
  const uncontrolled = createOverlay({ onOpenChange: (_open, details) => details.cancel() });
  uncontrolled.setOpen(true);
  expect(uncontrolled.source.model().open).toBe(false);
  controlled.lifetime.dispose();
  uncontrolled.lifetime.dispose();
});

it('lets a descendant consume Escape before the popup dismisses', async () => {
  const p = await fixture();
  let recording = true;
  const rendered = mount(
    p.element,
    view(() => (
      <button
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== 'Escape' || !recording) return;
          event.preventDefault();
          event.stopPropagation();
          recording = false;
        }}
      >
        Record shortcut
      </button>
    )),
    {},
  );
  cleanup.push(() => rendered.dispose());
  p.handle.setOpen(true);
  const button = p.element.querySelector('button')!;
  button.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  expect(recording).toBe(false);
  expect(p.handle.source.model().open).toBe(true);
  button.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  expect(p.handle.source.model().open).toBe(false);
});

it('canceling a pending delayed open stays closed without redundant change events', async () => {
  vi.useFakeTimers();
  const changes = vi.fn();
  const handle = createOverlay({ delay: 100, onOpenChange: changes });
  try {
    handle.showDelayed();
    handle.hide();
    handle.hide();
    await vi.advanceTimersByTimeAsync(100);
    expect(handle.source.model().open).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    handle.setOpen(true);
    handle.setOpen(true);
    expect(changes).toHaveBeenCalledTimes(1);
    handle.hide();
    expect(changes).toHaveBeenCalledTimes(2);
  } finally {
    handle.lifetime.dispose();
    vi.useRealTimers();
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
