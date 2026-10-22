// @vitest-environment happy-dom
import { view as bindingView, type DomMount } from 'effectweb';
import { renderView } from 'effectweb/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { createOverlay, popupBinding } from './overlay.js';
import type { PopupFocusOptions } from './popup-focus.js';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
async function popup(
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
  const work = await mountTestBinding(element, binding);
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
      work.update(popupBinding(input));
    },
  };
}
it('defaults to the trigger but allows a current explicit focus target', async () => {
  const p = await popup();
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.element);
  p.handle.hide();
  expect(document.activeElement).toBe(p.trigger);
  p.update({ current: p.editor });
  p.handle.setOpen(true);
  p.handle.hide();
  expect(document.activeElement).toBe(p.editor);
});
it('evaluates the latest callback before default restoration and respects false', async () => {
  const first = vi.fn(() => true);
  const p = await popup(first);
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
it('reports pointer interaction and honors an element returned by finalFocus', async () => {
  const p = await popup();
  const callback = vi.fn(() => p.editor);
  p.update(callback);
  p.handle.setOpen(true);
  p.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  p.handle.hide();
  expect(callback).toHaveBeenCalledWith('touch');
  expect(document.activeElement).toBe(p.editor);
});
it('does not redirect focus when an outside pointer dismisses the popup', async () => {
  const callback = vi.fn(() => true);
  const p = await popup(callback);
  p.handle.setOpen(true);
  p.editor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  p.editor.focus();
  expect(p.handle.source.model().open).toBe(false);
  expect(callback).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(p.editor);
});

it('restores focus once when an open popup is removed', async () => {
  const p = await popup();
  const callback = vi.fn(() => p.editor);
  p.update(callback);
  p.handle.setOpen(true);
  p.dispose();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(p.editor);
});

it('preserves trigger focus when initialFocus is false', async () => {
  const p = await popup(undefined, false);
  p.trigger.focus();
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.trigger);
});
it('uses explicit opening targets and reports the opening interaction', async () => {
  const input = document.createElement('input');
  document.body.append(input);
  const initial = vi.fn(() => input);
  const p = await popup(undefined, initial);
  p.handle.setOpen(true, {
    reason: 'trigger-press',
    event: new PointerEvent('pointerdown', { pointerType: 'touch' }),
  });
  expect(initial).toHaveBeenCalledWith('touch');
  expect(document.activeElement).toBe(input);
});
it('falls back to default focus when an initial-focus callback returns null', async () => {
  const p = await popup(undefined, () => null);
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.element);
});
it('preserves focus chosen by an initial-focus callback returning undefined', async () => {
  const p = await popup(undefined, () => {
    p.editor.focus();
  });
  p.handle.setOpen(true);
  expect(document.activeElement).toBe(p.editor);
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
