import { expect, test } from '@playwright/test';

test('portal targets retain their child state and events through updates and movement', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/portalFixture.tsx';
    const { mountPortal } = (await import(path)) as typeof import('../fixtures/portalFixture');
    const parent = document.createElement('main');
    const first = document.createElement('aside');
    const second = document.createElement('aside');
    const fullscreen = document.createElement('section');
    document.body.append(parent, first, second, fullscreen);
    const source = mountPortal(parent, first);
    await Promise.resolve();
    const input = first.querySelector('input')!;
    const content = first.querySelector('[data-portal-content]')!;
    const button = first.querySelector('button')!;
    const initial = { placed: !!input, parentEmpty: parent.textContent === '' };
    if (!input) throw new Error('Portal did not mount in its target');
    input.value = 'preserve draft';
    input.focus();
    input.setSelectionRange(3, 8);
    button.click();
    source.update(first, 'updated');
    const updated = { same: first.querySelector('input') === input, text: button.textContent };
    source.update(second, 'moved');
    const moved = {
      same: second.querySelector('input') === input,
      firstEmpty: first.childNodes.length === 0,
      draft: input.value,
      focused: document.activeElement === input,
      selection: [input.selectionStart, input.selectionEnd],
    };
    // The reader owns this external host and moves it into its fullscreen subtree.
    fullscreen.append(second);
    source.update(second, 'fullscreen');
    const externalMove = {
      same: second.querySelector('[data-portal-content]') === content,
      contained: fullscreen.contains(content),
      text: button.textContent,
    };
    source.update(undefined, 'body');
    const bodyDefault = content.parentElement?.parentElement === document.body;
    source.dispose();
    button.click();
    source.dispose();
    const disposed = {
      contentGone: !content.isConnected,
      secondEmpty: second.childNodes.length === 0,
      parentEmpty: parent.childNodes.length === 0,
      text: button.textContent,
      lifetime: source.lifetime,
    };
    parent.remove();
    first.remove();
    second.remove();
    fullscreen.remove();
    return { initial, updated, moved, externalMove, bodyDefault, disposed };
  });
  expect(result).toEqual({
    initial: { placed: true, parentEmpty: true },
    updated: { same: true, text: 'updated:1' },
    moved: {
      same: true,
      firstEmpty: true,
      draft: 'preserve draft',
      focused: true,
      selection: [3, 8],
    },
    externalMove: { same: true, contained: true, text: 'fullscreen:1' },
    bodyDefault: true,
    disposed: {
      contentGone: true,
      secondEmpty: true,
      parentEmpty: true,
      text: 'body:1',
      lifetime: { mounted: 1, disposed: 1 },
    },
  });
});

test('portal content uses the target SVG namespace and foreignObject HTML context', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/portalFixture.tsx';
    const { mountSvgPortal } = (await import(path)) as typeof import('../fixtures/portalFixture');
    const parent = document.createElement('main');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(parent, svg);
    const source = mountSvgPortal(parent, svg);
    const circle = svg.querySelector('circle');
    const html = svg.querySelector('[data-portal-html]');
    source.update(12);
    const rendered = {
      circle: circle?.namespaceURI,
      html: html?.namespaceURI,
      radius: circle?.getAttribute('r'),
      same: circle === svg.querySelector('circle'),
    };
    source.dispose();
    const remaining = svg.childNodes.length;
    parent.remove();
    svg.remove();
    return { rendered, remaining };
  });
  expect(result).toEqual({
    rendered: {
      circle: 'http://www.w3.org/2000/svg',
      html: 'http://www.w3.org/1999/xhtml',
      radius: '12',
      same: true,
    },
    remaining: 0,
  });
});

test('portal cleanup can unmount its owner during a namespace change', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/portalFixture.tsx';
    const { mountPortal } = (await import(path)) as typeof import('../fixtures/portalFixture');
    const parent = document.createElement('main');
    const html = document.createElement('aside');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(parent, html, svg);
    const source = mountPortal(parent, html, () => source.dispose());
    await Promise.resolve();
    source.update(svg, 'removed');
    await Promise.resolve();
    const remaining = {
      parent: parent.childNodes.length,
      html: html.childNodes.length,
      svg: svg.childNodes.length,
      lifetime: source.lifetime,
    };
    source.dispose();
    parent.remove();
    html.remove();
    svg.remove();
    return remaining;
  });
  expect(result).toEqual({ parent: 0, html: 0, svg: 0, lifetime: { mounted: 1, disposed: 1 } });
});
