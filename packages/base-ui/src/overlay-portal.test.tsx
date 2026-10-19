// @vitest-environment happy-dom
import { mount, view, domBinding } from 'effectweb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPopover, PopoverPortal, PopoverPopup, PopoverTrigger } from './popover.js';
import { createSelect, SelectPortal, SelectPopup, SelectTrigger, SelectItem } from './select.js';
import { createTooltip, TooltipPortal, TooltipPopup } from './tooltip.js';

const cleanup: (() => void)[] = [];
const shown = new WeakSet<Element>();
let animations: Animation[] = [];
beforeEach(() => {
  animations = [];
  const matches = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')!.value as (
    this: Element,
    selector: string,
  ) => boolean;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector) {
    return selector === ':popover-open' ? shown.has(this) : matches.call(this, selector);
  });
  for (const [name, value] of Object.entries({
    showPopover(this: HTMLElement) {
      shown.add(this);
    },
    hidePopover(this: HTMLElement) {
      shown.delete(this);
    },
    getAnimations() {
      return animations;
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
    cleanup.push(() =>
      previous
        ? Object.defineProperty(HTMLElement.prototype, name, previous)
        : Reflect.deleteProperty(HTMLElement.prototype, name),
    );
  }
});
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function fixture(options: Parameters<typeof createPopover>[0] = {}, keepMounted = false) {
  const popover = createPopover(options);
  const host = document.createElement('div');
  document.body.append(host);
  let mounted = 0,
    disposed = 0;
  const tracked = domBinding({}, () => {
    mounted++;
    return () => {
      disposed++;
    };
  });
  const Test = view(() => (
    <>
      <PopoverTrigger popover={popover}>Open</PopoverTrigger>
      <PopoverPortal popover={popover} keepMounted={keepMounted}>
        <PopoverPopup popover={popover} data-testid="popup">
          <input use={tracked} aria-label="Value" />
        </PopoverPopup>
      </PopoverPortal>
    </>
  ));
  const root = mount(host, Test, {});
  cleanup.push(() => {
    root.dispose();
    popover.lifetime.dispose();
  });
  return {
    popover,
    host,
    counts: () => ({ mounted, disposed }),
    popup: () => document.querySelector<HTMLElement>('[data-testid="popup"]'),
  };
}
it('does not mount closed popup children and releases them after close with focus restored', async () => {
  const f = fixture();
  expect(f.popup()).toBeNull();
  expect(f.counts()).toEqual({ mounted: 0, disposed: 0 });
  f.host.querySelector('button')!.click();
  await vi.waitFor(() => expect(f.popover.popup()).toBe(f.popup()));
  await vi.waitFor(() => expect(f.counts().mounted).toBe(1));
  expect(document.activeElement?.tagName).toBe('INPUT');
  f.popover.hide();
  await vi.waitFor(() => expect(f.popup()).toBeNull());
  expect(f.counts()).toEqual({ mounted: 1, disposed: 1 });
  expect(document.activeElement).toBe(f.host.querySelector('button'));
  f.popover.setOpen(true);
  await vi.waitFor(() => expect(f.counts().mounted).toBe(2));
});
it('retains exiting children and cancels stale exit completion on reopening', async () => {
  const f = fixture();
  f.popover.setOpen(true);
  await vi.waitFor(() => expect(f.counts().mounted).toBe(1));
  const original = f.popup();
  let finish!: () => void;
  animations = [
    {
      playState: 'running',
      effect: { getComputedTiming: () => ({ endTime: 200 }) },
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    } as unknown as Animation,
  ];
  f.popover.hide();
  expect(f.popup()).toBe(original);
  expect(f.popup()?.hasAttribute('data-ending-style')).toBe(true);
  f.popover.setOpen(true);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.popup()).toBe(original);
  expect(f.counts()).toEqual({ mounted: 1, disposed: 0 });
  animations = [];
  f.popover.hide();
  await vi.waitFor(() => expect(f.popup()).toBeNull());
});
it('waits for controlled open acceptance and honors explicit keepMounted', async () => {
  const f = fixture({ open: false });
  f.popover.setOpen(true);
  expect(f.popup()).toBeNull();
  f.popover.sync({ open: true });
  await vi.waitFor(() => expect(f.counts().mounted).toBe(1));
  f.popover.hide();
  expect(f.popup()).not.toBeNull();
  f.popover.sync({ open: false });
  await vi.waitFor(() => expect(f.popup()).toBeNull());
  const kept = fixture({}, true);
  await vi.waitFor(() => expect(kept.counts().mounted).toBe(1));
  const node = kept.popup();
  kept.popover.setOpen(true);
  kept.popover.hide();
  expect(kept.popup()).toBe(node);
  expect(kept.counts().disposed).toBe(0);
});
it('cancels delayed tooltip opening before any popup mounts', async () => {
  const tooltip = createTooltip({ delay: 20 });
  const host = document.createElement('div');
  document.body.append(host);
  const root = mount(
    host,
    view(() => (
      <TooltipPortal tooltip={tooltip}>
        <TooltipPopup tooltip={tooltip}>Tip</TooltipPopup>
      </TooltipPortal>
    )),
    {},
  );
  cleanup.push(() => {
    root.dispose();
    tooltip.lifetime.dispose();
  });
  tooltip.showDelayed();
  tooltip.hide();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  tooltip.setOpen(true);
  await vi.waitFor(() => expect(tooltip.popup()).toBeTruthy());
  tooltip.hide();
  await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')).toBeNull());
});
it('unmounts after finite exit motion and lets completion callbacks reopen', async () => {
  const complete = vi.fn();
  const f = fixture({ onOpenChangeComplete: complete });
  f.popover.setOpen(true);
  await vi.waitFor(() => expect(f.counts().mounted).toBe(1));
  let finish!: () => void;
  animations = [
    {
      playState: 'running',
      effect: { getComputedTiming: () => ({ endTime: 200 }) },
      finished: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    } as unknown as Animation,
  ];
  f.popover.hide();
  expect(f.counts().disposed).toBe(0);
  finish();
  await vi.waitFor(() => expect(f.counts().disposed).toBe(1));
  expect(f.popup()).toBeNull();
  expect(complete).toHaveBeenCalledWith(false);
  animations = [];
  complete.mockImplementation((open: boolean) => {
    if (!open) f.popover.setOpen(true);
  });
  f.popover.setOpen(true);
  await vi.waitFor(() => expect(f.counts().mounted).toBe(2));
  f.popover.hide();
  expect(f.popover.source.model().open).toBe(true);
  expect(f.popup()).not.toBeNull();
});
it('closes nested popups with their parent without retaining their children', async () => {
  const parent = createPopover();
  const child = createPopover({ parent });
  const host = document.createElement('div');
  document.body.append(host);
  const Test = view(() => (
    <>
      <PopoverTrigger popover={parent}>Parent</PopoverTrigger>
      <PopoverPortal popover={parent}>
        <PopoverPopup popover={parent} data-testid="parent-popup">
          <PopoverTrigger popover={child}>Child</PopoverTrigger>
          <PopoverPortal popover={child}>
            <PopoverPopup popover={child} data-testid="child-popup">
              <button>Child action</button>
            </PopoverPopup>
          </PopoverPortal>
        </PopoverPopup>
      </PopoverPortal>
    </>
  ));
  const root = mount(host, Test, {});
  cleanup.push(() => {
    root.dispose();
    child.lifetime.dispose();
    parent.lifetime.dispose();
  });
  parent.setOpen(true);
  await vi.waitFor(() => expect(parent.popup()).toBeTruthy());
  child.setOpen(true);
  await vi.waitFor(() => expect(child.popup()).toBeTruthy());
  parent.hide();
  await vi.waitFor(() =>
    expect(document.querySelectorAll('[data-testid$="-popup"]')).toHaveLength(0),
  );
  expect(child.source.model().open).toBe(false);
  expect(document.activeElement).toBe(host.querySelector('button'));
});

it('preserves closed select typeahead when keepMounted retains its option collection', async () => {
  const select = createSelect<unknown>({ defaultValue: 'a' });
  const host = document.createElement('div');
  document.body.append(host);
  const Test = view(() => (
    <>
      <SelectTrigger select={select}>Choose</SelectTrigger>
      <SelectPortal select={select} keepMounted>
        <SelectPopup select={select} alignItemWithTrigger={false}>
          <SelectItem select={select} value="a">
            Alpha
          </SelectItem>
          <SelectItem select={select} value="b">
            Beta
          </SelectItem>
        </SelectPopup>
      </SelectPortal>
    </>
  ));
  const root = mount(host, Test, {});
  cleanup.push(() => {
    root.dispose();
    select.lifetime.dispose();
  });
  await vi.waitFor(() => expect(select.overlay.popup()).toBeTruthy());
  expect(select.source.model().open).toBe(false);
  host
    .querySelector('button')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
  expect(select.source.model().value).toBe('b');
  expect(select.source.model().open).toBe(false);
});
