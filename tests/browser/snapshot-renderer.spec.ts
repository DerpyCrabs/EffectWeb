import { expect, test } from '@playwright/test';
import type { mountFixture } from '../fixtures/fixture';

declare global {
  interface Window {
    snapshotFixture: ReturnType<typeof mountFixture>;
    optimisticNode: Element | null;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.replaceChildren();
    const fixturePath = '/tests/fixtures/fixture.tsx';
    const fixture = (await import(fixturePath)) as typeof import('../fixtures/fixture');
    const host = document.createElement('div');
    document.body.append(host);
    window.snapshotFixture = fixture.mountFixture(host);
  });
});

test('plain snapshots, extracted helpers and destructuring update one row without remounting', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const fixture = window.snapshotFixture;
    const articles = [...document.querySelectorAll('article')];
    const before = fixture.counters.labels;
    fixture.edit(500, 'updated');
    const afterEdit = fixture.counters.labels;
    fixture.set({ title: 'Renamed', user: { name: 'Alice' } });
    const afterTitle = fixture.counters.labels;
    return {
      edited: afterEdit - before,
      unrelated: afterTitle - afterEdit,
      same: articles.every(
        (article, index) => article === document.querySelectorAll('article')[index],
      ),
    };
  });
  expect(result).toEqual({ edited: 1, unrelated: 0, same: true });
  await expect(page.locator('article[data-id="500"] button')).toHaveText('UPDATED');
  await expect(page.locator('h1')).toHaveText('Renamed');
  await expect(page.locator('main > p')).toHaveText('Alice');
  await page.locator('article[data-id="500"] button').click();
  await expect(page.locator('output')).toHaveText('500');
  expect(await page.evaluate(() => window.snapshotFixture.model().selectedText)).toBe('updated');
});

test('optimistic completion preserves the existing row while concurrent updates remain visible', async ({
  page,
}) => {
  await page.evaluate(() => window.snapshotFixture.sendOptimistic(-10000, 'Sending'));
  await expect(page.locator('article[data-id="-10000"] button')).toHaveText('SENDING');
  await page.evaluate(() => {
    window.optimisticNode = document.querySelector('article[data-id="-10000"]');
    const fixture = window.snapshotFixture;
    fixture.edit(500, 'Incoming edit');
    fixture.acknowledge(-10000, 9000);
  });
  await expect(page.locator('article[data-id="-10000"]')).toHaveAttribute('data-server-id', '9000');
  await expect(page.locator('article[data-id="500"] button')).toHaveText('INCOMING EDIT');
  expect(
    await page.evaluate(
      () => window.optimisticNode === document.querySelector('article[data-id="-10000"]'),
    ),
  ).toBe(true);
});

test('automatic collection identity preserves focus, DOM, and current event values through edits and moves', async ({
  page,
}) => {
  await page.locator('article[data-id="500"] input').focus();
  const result = await page.evaluate(() => {
    const fixture = window.snapshotFixture;
    const article = document.querySelector('article[data-id="500"]');
    const input = document.activeElement;
    fixture.prepend(50);
    const prependFocus = document.activeElement === input;
    const before = fixture.counters.labels;
    fixture.reverse();
    return {
      same: article === document.querySelector('article[data-id="500"]'),
      prependFocus,
      labels: fixture.counters.labels - before,
    };
  });
  expect(result).toEqual({ same: true, prependFocus: true, labels: 0 });
});

test('conditional removal releases listeners; optional data and remounts remain correct', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const fixture = window.snapshotFixture;
    const detached = document.querySelector('article button') as HTMLButtonElement;
    fixture.set({ visible: false, user: { name: 'first' } });
    detached.click();
    const selected = fixture.model().selected;
    fixture.set({ visible: true, user: undefined });
    fixture.dispose();
    return { selected, nodes: document.querySelectorAll('main').length };
  });
  expect(result).toEqual({ selected: -1, nodes: 0 });
});

test('duplicate identities fail explicitly and clean up a partial mount', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/fixture.tsx';
    const fixture = (await import(fixturePath)) as typeof import('../fixtures/fixture');
    const host = document.createElement('div');
    document.body.append(host);
    try {
      fixture.mountPrimitiveList(host, ['duplicate', 'duplicate']);
      return 'missing error';
    } catch (error) {
      return { error: String(error), children: host.childNodes.length };
    }
  });
  expect(result).toEqual({
    error: expect.stringContaining('Duplicate collection identity'),
    children: 0,
  });
});

test('one event sees one snapshot across multiple dispatches, including an extracted helper', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/fixture.tsx';
    const fixture = (await import(fixturePath)) as typeof import('../fixtures/fixture');
    const host = document.createElement('div');
    document.body.append(host);
    const source = fixture.mountEventSnapshot(host);
    host.querySelector('button')!.click();
    const first = source.model();
    host.querySelector('button')!.click();
    const second = source.model();
    source.dispose();
    return { first, second };
  });
  expect(result).toEqual({ first: { value: 1, seen: 0 }, second: { value: 2, seen: 1 } });
});

test('root collection regions keep updating after detached construction and branch switches', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/fixture.tsx';
    const fixture = (await import(fixturePath)) as typeof import('../fixtures/fixture');
    const host = document.createElement('div');
    document.body.append(host);
    const source = fixture.mountRootList(host);
    source.set({ visible: true, values: ['c', 'b', 'a'] });
    const reversed = host.textContent;
    source.set({ visible: false, values: [] });
    source.set({ visible: true, values: ['d', 'e'] });
    host.querySelector('button')!.click();
    const selected = host.textContent;
    source.dispose();
    return { reversed, selected, nodes: host.childNodes.length };
  });
  expect(result).toEqual({ reversed: 'cba', selected: 'd', nodes: 0 });
});

test('dynamic attributes remove obsolete styles and classes without resetting an unchanged input', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/fixture.tsx';
    const fixture = (await import(fixturePath)) as typeof import('../fixtures/fixture');
    const host = document.createElement('div');
    document.body.append(host);
    const source = fixture.mountAttributes(host);
    const input = host.querySelector('input')!;
    input.focus();
    input.setSelectionRange(2, 4);
    source.set({ className: 'renamed' });
    const keepsClass = host.firstElementChild!.className;
    source.set({ classes: { other: true }, style: { color: 'green' } });
    const node = host.firstElementChild as HTMLElement;
    const result = {
      keepsClass,
      classes: node.className,
      color: node.style.color,
      background: node.style.background,
      selection: [input.selectionStart, input.selectionEnd],
    };
    source.dispose();
    return result;
  });
  expect(result).toEqual({
    keepsClass: 'renamed active',
    classes: 'renamed other',
    color: 'green',
    background: '',
    selection: [2, 4],
  });
});

test('edits, tail appends and truncations preserve retained row nodes and focus', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const fixture = window.snapshotFixture;
    const articles = [...document.querySelectorAll('article')];
    const focused = articles[0]!.querySelector('button')!;
    focused.focus();
    const items = fixture.model().items;
    const observer = new MutationObserver(() => {});
    observer.observe(document.querySelector('main')!, { childList: true, subtree: true });
    fixture.set({ items: [...items, { ...items[0]!, id: 999999, text: 'tail' }] });
    fixture.edit(items[0]!.id, 'edited');
    fixture.set({ items: fixture.model().items.slice(0, -1) });
    const records = observer.takeRecords();
    observer.disconnect();
    return {
      stable: articles.every((node, index) => node === document.querySelectorAll('article')[index]),
      focus: document.activeElement === focused,
      removedRetained: records.some((record) =>
        [...record.removedNodes].some((node) => articles.includes(node as HTMLElement)),
      ),
      count: document.querySelectorAll('article').length,
    };
  });
  expect(result).toEqual({ stable: true, focus: true, removedRetained: false, count: 1000 });
});
