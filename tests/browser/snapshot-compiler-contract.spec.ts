import { expect, test } from '@playwright/test';

test('copied-array derivations update stable DOM without mutating frozen input', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/dependencyFixture.tsx';
    const { mountCopiedArrays } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = mountCopiedArrays(host);
    const sorted = host.querySelector('[data-sorted]')!;
    const reversed = host.querySelector('[data-reversed]')!;
    const before = [sorted.textContent, reversed.textContent];
    const next = Object.freeze([8, 4, 6]);
    fixture.set(next);
    const result = {
      before,
      after: [sorted.textContent, reversed.textContent],
      initial: [...fixture.initial],
      next: [...next],
      stable:
        sorted === host.querySelector('[data-sorted]') &&
        reversed === host.querySelector('[data-reversed]'),
    };
    fixture.dispose();
    const remaining = host.childNodes.length;
    host.remove();
    return { ...result, remaining };
  });
  expect(result).toEqual({
    before: ['1,2,3', '2,1,3'],
    after: ['4,6,8', '6,4,8'],
    initial: [3, 1, 2],
    next: [8, 4, 6],
    stable: true,
    remaining: 0,
  });
});

test('JSX constants keep declaration bindings through helper and list shadowing', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/compilerContractFixture.tsx';
    const { mountLexicalCapture } = await import(fixturePath);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountLexicalCapture(host);
    const captions = () => [...host.querySelectorAll('b')].map((node) => node.textContent);
    const before = captions();
    const row = host.querySelector('[data-row="a"]');
    source.set({ title: 'changed', values: ['b', 'a', 'c'] });
    host.querySelector('button')!.click();
    const result = {
      before,
      after: captions(),
      selected: source.model().selected,
      sameRow: row === host.querySelector('[data-row="a"]'),
      helper: host.querySelector('[data-helper]')!.getAttribute('data-helper'),
    };
    source.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({
    before: ['outer:OUTER', 'outer:OUTER', 'outer:OUTER', 'outer:OUTER'],
    after: [
      'changed:CHANGED',
      'changed:CHANGED',
      'changed:CHANGED',
      'changed:CHANGED',
      'changed:CHANGED',
    ],
    selected: 'changed',
    sameRow: true,
    helper: 'INNER',
  });
});

test('detached SVG roots, branches, lists and templates retain namespace across updates', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/compilerContractFixture.tsx';
    const { mountSvgContexts } = await import(fixturePath);
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(host);
    const source = mountSvgContexts(host);
    const namespaces = () =>
      [...host.querySelectorAll('*')].every(
        (node) =>
          node.namespaceURI ===
          (['div', 'p', 'span'].includes(node.localName)
            ? 'http://www.w3.org/1999/xhtml'
            : 'http://www.w3.org/2000/svg'),
      );
    const before = namespaces();
    const row = host.querySelector('[data-row="1"]');
    source.set({ x: 30, rows: [2, 1, 3] });
    const after = namespaces();
    const sameRow = row === host.querySelector('[data-row="1"]');
    const x = host.querySelector('[data-dynamic]')!.getAttribute('cx');
    const svgGraphics = host.querySelector('[data-dynamic]') instanceof SVGCircleElement;
    source.set({ visible: false, rows: [] });
    source.set({ visible: true, rows: [4] });
    const remount = namespaces();
    const html = host.querySelector('[data-html]') instanceof HTMLDivElement;
    source.dispose();
    const remaining = host.childNodes.length;
    host.remove();
    return { before, after, sameRow, x, svgGraphics, remount, html, remaining };
  });
  expect(result).toEqual({
    before: true,
    after: true,
    sameRow: true,
    x: '30',
    svgGraphics: true,
    remount: true,
    html: true,
    remaining: 0,
  });
});

test('template aliases refresh helper and stable row scopes and parenthesized methods track receivers', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/dependencyFixture.tsx';
    const { mountDependencies } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const source = mountDependencies(host);
    const before = host.textContent;
    const heading = host.querySelector('header b');
    const firstRow = host.querySelector('[data-row="a"]');
    source.set({ title: 'after', items: [{ visible: true }, { visible: true }] });
    const result = {
      before,
      after: host.textContent,
      defaultLabel: host.querySelector('section')!.dataset.default,
      sameHeading: heading === host.querySelector('header b'),
      sameRow: firstRow === host.querySelector('[data-row="a"]'),
    };
    source.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({
    before: 'beforebeforebefore1',
    after: 'afterafterafter2',
    defaultLabel: 'after',
    sameHeading: true,
    sameRow: true,
  });
});

test('destructured inputs preserve field granularity, defaults, rest and current event captures', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/compilerContractFixture.tsx';
    const { mountDestructured } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = mountDestructured(host);
    const simple = host.querySelector<HTMLButtonElement>('[data-simple]')!;
    const complex = host.querySelector<HTMLButtonElement>('[data-complex]')!;
    const initial = complex.textContent?.trim();
    const formats = fixture.formats();
    fixture.set({ unrelated: 1 });
    const unchanged = fixture.formats() === formats;
    fixture.set({ title: 'new', user: { name: 'Bob' }, items: ['c', 'b', 'a'] });
    complex.click();
    const selected = fixture.model().selected;
    simple.click();
    const result = {
      initial,
      unchanged,
      text: complex.textContent?.trim(),
      selected,
      simpleSelection: fixture.model().selected,
      simpleText: simple.textContent,
      same: simple === host.querySelector('[data-simple]'),
    };
    fixture.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({
    initial: 'fallback:a:1',
    unchanged: true,
    text: 'new:c:2',
    selected: 'new:Bob:c',
    simpleSelection: 'Bob',
    simpleText: 'BOB',
    same: true,
  });
});
