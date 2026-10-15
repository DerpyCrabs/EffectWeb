import { logicalKey } from './direction.js';
/** Roving focus among enabled items; `current=-1` starts at the appropriate end. */
export function nextIndex(
  count: number,
  current: number,
  key: string,
  orientation: 'horizontal' | 'vertical' = 'vertical',
  loop = true,
): number | null {
  if (count === 0) return null;
  if (key === 'Home' || key === 'PageUp') return 0;
  if (key === 'End' || key === 'PageDown') return count - 1;
  const delta =
    key === (orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight')
      ? 1
      : key === (orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft')
        ? -1
        : 0;
  if (!delta) return null;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return loop
    ? (current + delta + count) % count
    : Math.min(count - 1, Math.max(0, current + delta));
}
/** A per-popup buffer: repeated letters cycle, pauses begin a fresh query. */
export function createTypeahead(timeout = 500) {
  let query = '';
  let previous = -Infinity;
  return (labels: readonly string[], current: number, key: string, now: number): number | null => {
    if (key.length !== 1 || key === ' ') return null;
    query = now - previous > timeout ? key : query + key;
    previous = now;
    const normalized = query.toLocaleLowerCase();
    const search = Array.from(normalized).every((letter) => letter === normalized[0])
      ? normalized[0]!
      : normalized;
    for (let step = search.length > 1 ? 0 : 1; step <= labels.length; step++) {
      const index = (current + step + labels.length) % labels.length;
      if (labels[index]?.trim().toLocaleLowerCase().startsWith(search)) return index;
    }
    return null;
  };
}
/** Enabled descendants in document order for composite keyboard navigation. */
export const enabledItems = (root: HTMLElement, selector: string) =>
  [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (item) =>
      !item.hasAttribute('disabled') &&
      item.getAttribute('aria-disabled') !== 'true' &&
      (!root.matches('[role=menu], [role=listbox]') ||
        item.closest('[role=menu], [role=listbox]') === root),
  );
/** Move focus for arrows/Home/End, optionally activating the focused item. */
export function rove(
  event: KeyboardEvent,
  root: HTMLElement,
  selector: string,
  orientation: 'horizontal' | 'vertical' = 'vertical',
  activate = false,
) {
  const items = enabledItems(root, selector);
  const index = nextIndex(
    items.length,
    items.indexOf(root.ownerDocument.activeElement as HTMLElement),
    logicalKey(event.key, root),
    orientation,
  );
  if (index === null) return;
  event.preventDefault();
  items[index]?.focus();
  if (activate) items[index]?.click();
}

import { domBinding } from 'effectweb';
const acquireRoving = (root: HTMLElement, current: () => string) => {
  const sync = () => {
    const items = enabledItems(root, current());
    const active = root.ownerDocument.activeElement;
    const selected =
      items.find((item) => item === active) ??
      items.find(
        (item) =>
          item.getAttribute('aria-checked') === 'true' ||
          item.getAttribute('aria-selected') === 'true' ||
          item.getAttribute('aria-pressed') === 'true',
      ) ??
      items[0];
    for (const item of root.querySelectorAll<HTMLElement>(current())) {
      const value = item === selected ? 0 : -1;
      if (item.tabIndex !== value) item.tabIndex = value;
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'aria-selected', 'aria-checked', 'aria-pressed'],
  });
  root.addEventListener('focusin', sync);
  sync();
  return {
    update: sync,
    dispose: () => {
      observer.disconnect();
      root.removeEventListener('focusin', sync);
    },
  };
};
/** Keep exactly one enabled composite item in the sequential Tab order. */
export const rovingBinding = (selector: string) => domBinding(selector, acquireRoving);

/** A per-popup keyboard navigator shared by menus and Select listboxes. */
export function createListNavigation() {
  const typeahead = createTypeahead();
  return (event: KeyboardEvent, items: readonly HTMLElement[], active: Element | null) => {
    const index = items.indexOf(active as HTMLElement);
    const next =
      nextIndex(items.length, index, event.key) ??
      (!event.ctrlKey && !event.metaKey && !event.altKey
        ? typeahead(
            items.map((item) => item.textContent ?? ''),
            index,
            event.key,
            Date.now(),
          )
        : null);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };
}
