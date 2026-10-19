// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from 'effectweb';
import { createScrollArea, ScrollAreaViewport } from './scroll-area.js';

const cleanups: (() => void)[] = [];
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const resizes: TestResizeObserver[] = [];
const mutations: TestMutationObserver[] = [];
let acquired: Promise<void>;
let resolveAcquired: () => void;

class TestResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();
  readonly observe = vi.fn((target: Element) => {
    this.targets.add(target);
    resolveAcquired();
  });
  readonly unobserve = vi.fn((target: Element) => {
    this.targets.delete(target);
  });
  readonly disconnect = vi.fn(() => this.targets.clear());
  constructor(readonly callback: ResizeObserverCallback) {
    resizes.push(this);
  }
  deliver(target: Element) {
    if (this.targets.has(target)) this.callback([{ target } as ResizeObserverEntry], this);
  }
}
class TestMutationObserver implements MutationObserver {
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = () => [];
  constructor(readonly callback: MutationCallback) {
    mutations.push(this);
  }
  deliver(records: Pick<MutationRecord, 'type' | 'target'>[]) {
    this.callback(records as MutationRecord[], this);
  }
}
beforeEach(() => {
  acquired = new Promise<void>((resolve) => {
    resolveAcquired = resolve;
  });
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('MutationObserver', TestMutationObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  frames.clear();
  resizes.length = 0;
  mutations.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function nextFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}
async function viewport() {
  const scrollArea = createScrollArea();
  const host = document.createElement('div');
  document.body.append(host);
  const errors: unknown[] = [];
  const mounted = mount(
    host,
    ScrollAreaViewport,
    { scrollArea },
    { onError: (error) => errors.push(error) },
  );
  cleanups.push(() => scrollArea.lifetime.dispose(), mounted.dispose);
  await acquired;
  expect(errors).toEqual([]);
  const element = host.firstElementChild as HTMLElement;
  let extent = 200;
  const readHeight = vi.fn(() => extent);
  Object.defineProperties(element, {
    clientHeight: { get: () => 100 },
    clientWidth: { get: () => 150 },
    scrollHeight: { get: readHeight },
    scrollWidth: { get: () => 150 },
  });
  const child = document.createElement('div');
  const text = document.createElement('span');
  text.textContent = 'Initial text';
  child.append(text);
  element.append(child);
  mutations[0]!.deliver([{ type: 'childList', target: element }]);
  nextFrame();
  readHeight.mockClear();
  return {
    scrollArea,
    element,
    resize: resizes[0]!,
    mutation: mutations[0]!,
    readHeight,
    mounted,
    setExtent: (value: number) => {
      extent = value;
    },
  };
}

describe('scroll viewport observation', () => {
  it('coalesces nested text and resize notifications into one measurement without restarting observations', async () => {
    const fixture = await viewport();
    const child = fixture.element.firstElementChild!;
    const text = child.firstChild!.firstChild!;
    const observed = fixture.resize.observe.mock.calls.length;
    fixture.setExtent(600);
    text.textContent = 'Longer streamed content';
    fixture.mutation.deliver([{ type: 'characterData', target: text }]);
    fixture.resize.deliver(child);
    fixture.mutation.deliver([{ type: 'childList', target: child }]);
    expect(fixture.scrollArea.source.model().scrollHeight).toBe(200);
    expect(fixture.readHeight).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    nextFrame();
    expect(fixture.scrollArea.source.model().scrollHeight).toBe(600);
    expect(fixture.readHeight).toHaveBeenCalledTimes(1);
    expect(fixture.resize.observe).toHaveBeenCalledTimes(observed);
    expect(fixture.resize.unobserve).not.toHaveBeenCalled();
    expect(fixture.resize.disconnect).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('tracks replaced direct children and measures later growth of the replacement', async () => {
    const fixture = await viewport();
    const original = fixture.element.firstElementChild!;
    const replacement = document.createElement('section');
    original.replaceWith(replacement);
    fixture.mutation.deliver([{ type: 'childList', target: fixture.element }]);
    expect(fixture.resize.targets).toEqual(new Set([fixture.element, replacement]));
    expect(fixture.resize.unobserve).toHaveBeenCalledExactlyOnceWith(original);
    nextFrame();
    fixture.setExtent(900);
    fixture.resize.deliver(original);
    expect(frames.size).toBe(0);
    fixture.resize.deliver(replacement);
    nextFrame();
    expect(fixture.scrollArea.source.model().scrollHeight).toBe(900);
  });

  it('preserves immediate scroll state and releases pending measurements on removal', async () => {
    const fixture = await viewport();
    fixture.element.scrollTop = 42;
    fixture.element.dispatchEvent(new Event('scroll'));
    expect(fixture.scrollArea.source.model()).toMatchObject({ y: 42, active: true });
    fixture.scrollArea.scroll('vertical', 65);
    expect(fixture.scrollArea.source.model().y).toBe(65);
    fixture.mutation.deliver([{ type: 'childList', target: fixture.element }]);
    expect(frames.size).toBe(1);
    fixture.readHeight.mockClear();
    fixture.mounted.dispose();
    expect(frames.size).toBe(0);
    expect(fixture.scrollArea.viewport).toBeUndefined();
    expect(fixture.resize.disconnect).toHaveBeenCalledTimes(1);
    expect(fixture.mutation.disconnect).toHaveBeenCalledTimes(1);
    nextFrame();
    expect(fixture.readHeight).not.toHaveBeenCalled();
  });
});

it('measures newly attached viewports together before publishing any scrollbar changes', () => {
  const events: string[] = [];
  const areas = ['first', 'second'].map((name) => {
    const area = createScrollArea();
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollHeight', {
      get: () => {
        events.push(`read:${name}`);
        return 500;
      },
    });
    cleanups.push(area.lifetime.dispose);
    cleanups.push(area.source.subscribe(() => events.push(`publish:${name}`)));
    area.attach(element);
    return area;
  });
  expect(events).toEqual([]);
  expect(frames.size).toBe(1);
  nextFrame();
  expect(events).toEqual(['read:first', 'read:second', 'publish:first', 'publish:second']);
  expect(areas.map((area) => area.source.model().scrollHeight)).toEqual([500, 500]);
});

it('does not measure a detached viewport while preserving another pending viewport', () => {
  const first = createScrollArea();
  const second = createScrollArea();
  cleanups.push(first.lifetime.dispose, second.lifetime.dispose);
  const firstElement = document.createElement('div');
  const secondElement = document.createElement('div');
  const readFirst = vi.fn(() => 100);
  Object.defineProperty(firstElement, 'scrollHeight', { get: readFirst });
  Object.defineProperty(secondElement, 'scrollHeight', { get: () => 300 });
  first.attach(firstElement);
  second.attach(secondElement);
  first.attach(undefined);
  nextFrame();
  expect(readFirst).not.toHaveBeenCalled();
  expect(second.source.model().scrollHeight).toBe(300);
});
