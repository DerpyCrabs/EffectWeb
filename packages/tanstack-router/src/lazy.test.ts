// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { view, type View } from 'effectweb';
import { renderView } from 'effectweb/testing';
import { lazyRouteComponent } from './lazy';

const missing = () => new Error('Failed to fetch dynamically imported module: /stale-route.js');
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.replaceChildren();
});

it('preloads default exports once and renders the loaded native view', async () => {
  const importer = vi.fn(async () => ({ default: view<{}>(() => 'loaded') }));
  const Lazy = lazyRouteComponent(importer);
  await Promise.all([Lazy.preload(), Lazy.preload()]);
  const parent = document.createElement('div');
  const mounted = renderView(parent, Lazy, {});
  try {
    await vi.waitFor(() => expect(parent.textContent).toBe('loaded'));
    expect(importer).toHaveBeenCalledTimes(1);
  } finally {
    mounted.dispose();
  }
});

it('does not reload for a speculative missing chunk, but recovers once on placement', async () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  const Lazy = lazyRouteComponent(async (): Promise<{ Page: View<{}, never> }> => {
    throw missing();
  }, 'Page');
  await Lazy.preload();
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  const mounted = renderView(document.createElement('div'), Lazy, {});
  try {
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await Lazy.preload();
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    mounted.dispose();
  }
  const onError = vi.fn();
  const retry = renderView(document.createElement('div'), Lazy, {}, { onError });
  try {
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    retry.dispose();
  }
});

it('does not reload when a missing import settles after its placement is removed', async () => {
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  let reject!: (error: Error) => void;
  const Lazy = lazyRouteComponent(
    () =>
      new Promise<{ default: View<{}, never> }>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const mounted = renderView(document.createElement('div'), Lazy, {});
  mounted.dispose();
  reject(missing());
  await Lazy.preload();
  await Promise.resolve();
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});
