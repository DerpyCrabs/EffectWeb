import { expect, test } from '@playwright/test';

test('accepted authoring contracts preserve DOM values, dispatch and owned content', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/contractsFixture.tsx';
    const { mountContracts } = (await import(
      path
    )) as typeof import('../fixtures/contractsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const f = mountContracts(host);
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
    await settled();
    const read = () => ({
      selected: Array.from(host.querySelectorAll('select'), (select) => select.value),
      styles: Array.from(
        host.querySelectorAll<HTMLElement>('[data-style],[data-style-spread]'),
        (node) => ({ color: node.style.color, background: node.style.backgroundColor }),
      ),
      spellcheck: host.querySelector<HTMLInputElement>('[data-spell]')!.spellcheck,
      translate: host.querySelector<HTMLElement>('[data-translate]')!.translate,
      staticTranslate: host.querySelector<HTMLElement>('[data-static]')!.translate,
      download: host.querySelector('[data-download]')!.getAttribute('download'),
      draggable: host.querySelector<HTMLImageElement>('[data-drag]')!.draggable,
      editable: host.querySelector<HTMLElement>('[data-edit]')!.isContentEditable,
      static: ['draggable', 'spellcheck', 'contenteditable'].map((name) =>
        host.querySelector('[data-static]')!.getAttribute(name),
      ),
      values: host.querySelector('[data-values]')!.textContent,
      slots: Array.from(host.querySelectorAll('[data-cell]'), (node) => node.textContent),
      own: host.querySelector('[data-own-portal]')!.textContent,
      overlay: document.querySelector('[data-overlay]')!.textContent,
      scalar: host.querySelector('[data-scalar]')!.textContent,
    });
    const before = read();
    const firstCell = host.querySelector('[data-cell]');
    host.querySelector<HTMLButtonElement>('[data-bound]')!.click();
    const clicked = f.source.model().clicked;
    f.source.send({
      selected: 'c',
      options: ['b', 'c'],
      style: { color: 'green' },
      label: 'next',
      values: ['new', ['array'], 3],
      flag: true,
    });
    const updated = read();
    const sameCell = firstCell === host.querySelector('[data-cell]');
    f.source.send({ options: [] });
    const emptySelection = read().selected;
    f.source.send({ options: ['x', 'c'] });
    const restoredSelection = read().selected;
    f.source.send({ style: 'color:purple;border:1px solid red' });
    f.source.send({ style: {}, showSlots: false, values: [] });
    await settled();
    const cleared = {
      values: read().values,
      cells: read().slots,
      css: host.querySelector<HTMLElement>('[data-style]')!.style.cssText,
      lifetime: f.lifetime(),
    };
    // A separately owned DOM integration can update options without a parent snapshot tick.
    const option = document.createElement('option');
    option.value = 'z';
    option.textContent = 'z';
    host.querySelector('select')!.replaceChildren(option);
    await settled();
    const externalOptions = host.querySelector('select')!.value;
    f.dispose();
    await settled();
    const disposed = {
      children: host.childNodes.length,
      portal: document.querySelector('[data-overlay]') !== null,
      lifetime: f.lifetime(),
    };
    host.remove();
    return {
      before,
      clicked,
      updated,
      sameCell,
      emptySelection,
      restoredSelection,
      cleared,
      externalOptions,
      disposed,
      errors: f.errors,
    };
  });
  expect(result.before).toEqual({
    selected: ['b', 'b'],
    styles: [
      { color: 'red', background: 'blue' },
      { color: 'red', background: 'blue' },
    ],
    spellcheck: false,
    translate: false,
    staticTranslate: false,
    download: null,
    draggable: false,
    editable: false,
    static: ['false', 'false', 'false'],
    values: 'ab2',
    slots: ['first:one', 'first:two'],
    own: 'first',
    overlay: 'first',
    scalar: 'first',
  });
  expect(result.clicked).toBe(1);
  expect(result.updated).toEqual({
    selected: ['c', 'c'],
    styles: [
      { color: 'green', background: '' },
      { color: 'green', background: '' },
    ],
    spellcheck: true,
    translate: true,
    staticTranslate: false,
    download: '',
    draggable: true,
    editable: true,
    static: ['false', 'false', 'false'],
    values: 'newarray3',
    slots: ['next:one', 'next:two'],
    own: 'next',
    overlay: 'next',
    scalar: 'next',
  });
  expect(result.sameCell).toBe(true);
  expect(result.emptySelection).toEqual(['', '']);
  expect(result.restoredSelection).toEqual(['c', 'c']);
  expect(result.cleared).toEqual({
    values: '',
    cells: [],
    css: '',
    lifetime: { starts: 2, stops: 2 },
  });
  expect(result.externalOptions).toBe('');
  expect(result.disposed).toEqual({
    children: 0,
    portal: false,
    lifetime: { starts: 2, stops: 2 },
  });
  expect(result.errors).toEqual([]);
});

test('invalid dynamic content is reported before replacing the last valid content and can recover', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/contractsFixture.tsx';
    const { mountContracts } = (await import(
      path
    )) as typeof import('../fixtures/contractsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const f = mountContracts(host);
    const content = () => host.querySelector('[data-values]')!.textContent;
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    // @ts-expect-error Deliberate cyclic input exercises the untyped runtime boundary.
    f.source.send({ values: cyclic });
    const afterCycle = content();
    // Runtime guard for callers outside the typed JSX contract.
    // @ts-expect-error Unowned native nodes must also fail at the runtime boundary.
    f.source.send({ values: document.createTextNode('unowned') });
    const afterNode = content();
    f.source.send({ values: ['recovered', [4]] });
    const recovered = content();
    f.dispose();
    host.remove();
    return { afterCycle, afterNode, recovered, errors: f.errors };
  });
  expect(result.afterCycle).toBe('ab2');
  expect(result.afterNode).toBe('ab2');
  expect(result.recovered).toBe('recovered4');
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain('cannot contain cycles');
  expect(result.errors[1]).toContain('owned DOM host');
});
