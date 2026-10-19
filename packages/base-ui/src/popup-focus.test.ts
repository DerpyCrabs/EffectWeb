// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createOverlay, popupBinding } from './overlay.js';
import type { PopupFocusOptions } from './popup-focus.js';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function popup(
  finalFocus?: PopupFocusOptions['finalFocus'],
  initialFocus?: PopupFocusOptions['initialFocus'],
) {
  const trigger = document.createElement('button');
  const editor = document.createElement('textarea');
  const element = document.createElement('div');
  element.tabIndex = -1;
  document.body.append(trigger, editor, element);
  let open = false;
  element.showPopover = () => {
    open = true;
  };
  element.hidePopover = () => {
    open = false;
  };
  Object.defineProperty(element, 'matches', {
    value: (selector: string) => selector === ':popover-open' && open,
  });
  element.getAnimations = () => [];
  const handle = createOverlay();
  handle.attachTrigger(trigger);
  let input = { handle, kind: 'menu' as const, finalFocus, initialFocus };
  const binding = popupBinding(input);
  const work = binding.acquire(element, () => input);
  if (!work || typeof work !== 'object' || !('dispose' in work))
    throw new Error('Expected popup lifetime');
  disposals.push(() => {
    work.dispose();
    handle.lifetime.dispose();
  });
  return {
    dispose: () => work.dispose(),
    handle,
    element,
    editor,
    trigger,
    update(next: PopupFocusOptions['finalFocus']) {
      input = { ...input, finalFocus: next };
      work.update?.();
    },
  };
}
it('defaults to the trigger but allows a current explicit focus target', () => {
  const p = popup();
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.element);
  p.handle.hide();
  expect(document.activeElement).toBe(p.trigger);
  p.update({ current: p.editor });
  p.handle.setOpen(true);
  p.handle.hide();
  expect(document.activeElement).toBe(p.editor);
});
it('evaluates the latest callback before default restoration and respects false', () => {
  const first = vi.fn(() => true);
  const p = popup(first);
  const callback = vi.fn(() => {
    p.editor.focus();
    return false;
  });
  p.handle.setOpen(true);
  p.update(callback);
  p.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(first).not.toHaveBeenCalled();
  expect(callback).toHaveBeenCalledWith('keyboard');
  expect(document.activeElement).toBe(p.editor);
});
it('reports pointer interaction and honors an element returned by finalFocus', () => {
  const p = popup();
  const callback = vi.fn(() => p.editor);
  p.update(callback);
  p.handle.setOpen(true);
  p.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  p.handle.hide();
  expect(callback).toHaveBeenCalledWith('touch');
  expect(document.activeElement).toBe(p.editor);
});
it('does not redirect focus when an outside pointer dismisses the popup', () => {
  const callback = vi.fn(() => true);
  const p = popup(callback);
  p.handle.setOpen(true);
  p.editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  p.editor.focus();
  expect(p.handle.source.model().open).toBe(false);
  expect(callback).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(p.editor);
});

it('restores focus once when an open popup is removed', () => {
  const p = popup();
  const callback = vi.fn(() => p.editor);
  p.update(callback);
  p.handle.setOpen(true);
  p.dispose();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(p.editor);
});

it('preserves trigger focus when initialFocus is false', () => {
  const p = popup(undefined, false);
  p.trigger.focus();
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.trigger);
});
it('uses explicit opening targets and reports the opening interaction', () => {
  const input = document.createElement('input');
  document.body.append(input);
  const initial = vi.fn(() => input);
  const p = popup(undefined, initial);
  p.handle.setOpen(true, {
    reason: 'trigger-press',
    event: new PointerEvent('pointerdown', { pointerType: 'touch' }),
  });
  expect(initial).toHaveBeenCalledWith('touch');
  expect(document.activeElement).toBe(input);
});
it('falls back to default focus when an initial-focus callback returns null', () => {
  const p = popup(undefined, () => null);
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.element);
});
it('preserves focus chosen by an initial-focus callback returning undefined', () => {
  const p = popup(undefined, () => {
    p.editor.focus();
  });
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.editor);
});
