// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const text = (parent: Element, selector: string) => parent.querySelector(selector)?.textContent;

it('renders the matched tree through outlets, passing layout props down', async () => {
  const { mountRoutes } = await import('../fixtures/routerViewFixture');
  const parent = document.createElement('div');
  document.body.append(parent);
  const app = await mountRoutes(parent);
  try {
    expect(text(parent, 'main nav .home')).toBe('home from root');
    await app.router.navigate({ to: '/files/$name', params: { name: 'notes' } });
    await flush();
    expect(text(parent, 'main nav .file')).toBe('notes:5');
    expect(parent.querySelector('.home')).toBeNull();
    await app.router.navigate({ to: '/files/$name', params: { name: 'readme' } });
    await flush();
    expect(text(parent, '.file')).toBe('readme:6');
    app.history.back();
    await flush();
    await flush();
    expect(text(parent, '.file')).toBe('notes:5');
    expect(app.router.state.status).toBe('idle');
    expect(app.router.state.resolvedLocation?.pathname).toBe('/files/notes');
  } finally {
    app.dispose();
  }
});

it('shows pending, error and not-found views and recovers through reset and navigation', async () => {
  const { mountRoutes } = await import('../fixtures/routerViewFixture');
  const parent = document.createElement('div');
  document.body.append(parent);
  const app = await mountRoutes(parent);
  try {
    const slow = app.router.navigate({ to: '/files/$name', params: { name: 'slow' } });
    await flush();
    await flush();
    expect(text(parent, '.pending')).toBe('loading');
    app.release();
    await slow;
    await flush();
    expect(text(parent, '.file')).toBe('slow:1');

    await app.router.navigate({ to: '/files/$name', params: { name: 'boom' } });
    await flush();
    await flush();
    expect(text(parent, '.error')).toMatch(/^Error: file exploded/);
    await app.router.navigate({ to: '/files/$name', params: { name: 'ghost' } });
    await flush();
    await flush();
    expect(text(parent, '.missing')).toBe('missing');
    expect(parent.querySelector('.error')).toBeNull();
    await app.router.navigate({ to: '/' });
    await flush();
    expect(text(parent, '.home')).toBe('home from root');
    expect(parent.querySelector('.missing')).toBeNull();
  } finally {
    app.dispose();
  }
});

it('loads lazy route views once and navigates through links', async () => {
  const { mountRoutes } = await import('../fixtures/routerViewFixture');
  const parent = document.createElement('div');
  document.body.append(parent);
  const app = await mountRoutes(parent, '/about');
  try {
    await flush();
    await flush();
    expect(text(parent, '.lazy')).toBe('lazy page');
    parent
      .querySelector<HTMLAnchorElement>('a.to-notes')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(text(parent, '.file')).toBe('notes:5');
    expect(app.history.location.pathname).toBe('/files/notes');
  } finally {
    app.dispose();
  }
  expect(app.history.subscribers.size).toBe(0);
  await expect(app.router.load()).rejects.toThrow('disposed router');
});

it('lets an explicit false error component propagate to the parent rather than the router default', async () => {
  const { mountOptOutRoutes } = await import('../fixtures/routerViewFixture');
  const parent = document.createElement('div');
  const onParentCatch = vi.fn();
  const onChildCatch = vi.fn();
  const dispose = await mountOptOutRoutes(parent, onParentCatch, onChildCatch);
  try {
    await expect.poll(() => text(parent, '.parent-error')).toBe('child failed');
    expect(parent.querySelector('.default-error')).toBeNull();
    expect(onParentCatch).toHaveBeenCalledTimes(1);
    expect(onChildCatch).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
