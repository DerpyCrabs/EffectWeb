import { expect, test } from '@playwright/test';

test('compiled children forward, mount independently and preserve captures and local state', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/slotsFixture.tsx';
    const { mountSlots } = (await import(path)) as typeof import('../fixtures/slotsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountSlots(host);
    await Promise.resolve();
    const first = host.querySelector('section button') as HTMLButtonElement;
    const second = host.querySelector('aside button') as HTMLButtonElement;
    first.click();
    source.set({ title: 'next' });
    second.click();
    host.querySelector<HTMLButtonElement>('[data-value]')!.click();
    const updated = {
      first: first.textContent,
      second: second.textContent,
      same:
        first === host.querySelector('section button') &&
        second === host.querySelector('aside button'),
      selected: source.model().selected,
      footer: host.querySelector('footer')!.textContent,
      row: host.querySelector('output')!.textContent,
      mounts: source.lifetime.mounted,
    };
    host.querySelector<HTMLButtonElement>('[data-toggle]')!.click();
    const disposedOne = source.lifetime.disposed;
    second.click();
    source.set({ title: 'last' });
    host.querySelector<HTMLButtonElement>('[data-toggle]')!.click();
    await Promise.resolve();
    const replaced = host.querySelector('aside button')!.textContent;
    source.set({ visible: false });
    const hidden = {
      mounted: source.lifetime.mounted,
      disposed: source.lifetime.disposed,
      buttons: host.querySelectorAll('button').length,
    };
    source.dispose();
    const remaining = host.childNodes.length;
    host.remove();
    return { updated, disposedOne, replaced, hidden, remaining };
  });
  expect(result).toEqual({
    updated: {
      first: 'NEXT:1',
      second: 'NEXT:1',
      same: true,
      selected: 'next',
      footer: 'next',
      row: 'NEXT:argument!',
      mounts: 2,
    },
    disposedOne: 1,
    replaced: 'LAST:0',
    hidden: { mounted: 3, disposed: 3, buttons: 0 },
    remaining: 0,
  });
});

test('slots retain SVG and foreignObject insertion context', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/slotsFixture.tsx';
    const { mountSvgSlots } = (await import(path)) as typeof import('../fixtures/slotsFixture');
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(host);
    const source = mountSvgSlots(host);
    const first = host.querySelector('[data-child]');
    source.set(30);
    const result = {
      svg: [...host.querySelectorAll('circle')].every(
        (node) => node instanceof SVGCircleElement && node.getAttribute('cx') === '30',
      ),
      html: host.querySelector('div') instanceof HTMLDivElement,
      same: first === host.querySelector('[data-child]'),
      row: host.querySelector('[data-row]')!.getAttribute('cy'),
    };
    source.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({ svg: true, html: true, same: true, row: '10' });
});

test('derived slot placements survive structural sharing and replacement with other content', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/slotsFixture.tsx';
    const { mountChangingSlots } = (await import(
      path
    )) as typeof import('../fixtures/slotsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountChangingSlots(host);
    const input = host.querySelector('input')!;
    input.value = 'local edit';
    source.set({ value: { title: 'two', stable: { n: 1 } } });
    const updated = {
      label: input.getAttribute('aria-label'),
      same: input === host.querySelector('input'),
      value: input.value,
    };
    source.set({ mode: 'second' });
    const second = host.textContent;
    const detached = !input.isConnected;
    source.set({ mode: 'text' });
    const plain = host.textContent;
    source.set({ mode: 'first' });
    const returned = host.querySelector('input')!.getAttribute('aria-label');
    source.dispose();
    const remaining = host.childNodes.length;
    host.remove();
    return { updated, second, detached, plain, returned, remaining };
  });
  expect(result).toEqual({
    updated: { label: 'two', same: true, value: 'local edit' },
    second: 'two',
    detached: true,
    plain: 'plain',
    returned: 'two',
    remaining: 0,
  });
});
