import { expect, test } from '@playwright/test';

test('early returns and grouped switch cases preserve state and close branch lifetimes', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/controlFlowFixture.tsx';
    const { mountControlFlow } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountControlFlow(host);
    await Promise.resolve();
    const first = host.querySelector('button')!;
    first.click();
    source.set({ item: { kind: 'cached', title: 'second' }, title: 'changed' });
    const grouped = {
      same: first === host.querySelector('button'),
      text: first.textContent,
      caption: host.querySelector('[data-caption]')!.textContent,
      ...source.lifetime,
    };
    source.set({ item: { kind: 'error', message: 'unavailable' } });
    const failure = { text: host.querySelector('[role="alert"]')!.textContent, ...source.lifetime };
    source.set({ item: { kind: 'ready', title: 'third' } });
    await Promise.resolve();
    const restored = {
      different: first !== host.querySelector('button'),
      text: host.querySelector('button')!.textContent,
      ...source.lifetime,
    };
    source.set({ loading: true });
    const loading = { text: host.textContent, ...source.lifetime };
    source.set({ loading: false, title: '' });
    await Promise.resolve();
    const fallthrough = host.querySelector('button')!.textContent;
    source.set({ item: { kind: 'error', message: 'missing' } });
    const nested = host.textContent;
    source.dispose();
    const disposed = { remaining: host.childNodes.length, ...source.lifetime };
    host.remove();
    return { grouped, failure, restored, loading, fallthrough, nested, disposed };
  });
  expect(result).toEqual({
    grouped: { same: true, text: 'SECOND:1', caption: 'changed', mounted: 1, disposed: 0 },
    failure: { text: 'unavailable', mounted: 1, disposed: 1 },
    restored: { different: true, text: 'THIRD:0', mounted: 2, disposed: 1 },
    loading: { text: 'Loading', mounted: 2, disposed: 2 },
    fallthrough: 'THIRD:0',
    nested: 'empty:missing',
    disposed: { remaining: 0, mounted: 3, disposed: 3 },
  });
});

test('grouped default labels keep source-order precedence and preserve fallback DOM', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/controlFlowFixture.tsx';
    const { mountDefaultGroup } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountDefaultGroup(host);
    const input = host.querySelector('input')!;
    input.value = 'draft';
    source.set({ kind: 'unlisted' });
    const same = input === host.querySelector('input');
    const retained = host.querySelector('input')!.value;
    source.set({ kind: 'other', other: 'other' });
    const other = host.textContent;
    source.dispose();
    host.remove();
    return { same, retained, other };
  });
  expect(result).toEqual({ same: true, retained: 'draft', other: 'Other' });
});
