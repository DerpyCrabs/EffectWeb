import { expect, test } from '@playwright/test';

test('cloned templates retain dynamic siblings, forwarded props, snapshot captures and Effect events', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/templateOptimizationFixture.tsx';
    const { mountTemplates } = (await import(
      path
    )) as typeof import('../fixtures/templateOptimizationFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const first = mountTemplates(host);
    const second = mountTemplates(host);
    const sections = [...host.querySelectorAll('section')];
    const retained = sections[0]!.querySelector('div');
    (sections[0]!.querySelector('button') as HTMLButtonElement).click();
    const snapshot = {
      seen: [...first.seen],
      count: first.source.model().count,
      other: second.source.model().count,
    };
    first.source.send({ visible: false, suffix: '?' });
    const order = [...sections[0]!.children].map((node) => node.tagName);
    const props = sections[0]!.querySelector('aside')!.textContent;
    (sections[0]!.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await new Promise((done) => setTimeout(done, 0));
    const effectCount = first.source.model().count;
    first.source.send({ visible: true });
    const stable = sections[0]!.querySelector('div') === retained;
    const text = sections[0]!.textContent;
    const old = sections[0]!.querySelector('button') as HTMLButtonElement;
    first.dispose();
    old.click();
    const disposed = first.seen.length;
    second.dispose();
    host.remove();
    return { snapshot, order, props, effectCount, stable, text, disposed };
  });
  expect(result).toEqual({
    snapshot: { seen: [0], count: 2, other: 0 },
    order: ['DIV', 'FOOTER'],
    props: '2??Forward',
    effectCount: 7,
    stable: true,
    text: 'before 7SnapshotEffect7??Forwardafter 7left7?righttail',
    disposed: 1,
  });
});

test('templates preserve exact trees, documents and both insertion namespaces', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/templateOptimizationFixture.tsx';
    const { mountContexts } = (await import(
      path
    )) as typeof import('../fixtures/templateOptimizationFixture');
    const results = [];
    for (const svg of [false, true]) {
      for (const kind of ['html', 'svg'] as const) {
        const doc = document.implementation.createHTMLDocument();
        const host = svg
          ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
          : doc.createElement('div');
        const fixture = mountContexts(host, kind);
        fixture.source.send('after');
        const elements = [...host.querySelectorAll('*')];
        results.push({
          kind,
          svg,
          text: host.textContent,
          namespaces: [...new Set(elements.map((e) => e.namespaceURI))],
          sameDocument: elements.every((e) => e.ownerDocument === doc),
          title: host.querySelector('span')?.getAttribute('title'),
        });
        fixture.dispose();
      }
    }
    const exact = document.createElement('div');
    const fixture = mountContexts(exact, 'exact');
    const shapes = {
      table: exact.querySelector('table')!.firstElementChild!.tagName,
      paragraph: exact.querySelector('p')!.firstElementChild!.tagName,
      buttons: exact.querySelector('button')!.firstElementChild!.tagName,
    };
    fixture.dispose();
    return { results, shapes };
  });
  expect(result.shapes).toEqual({ table: 'TR', paragraph: 'DIV', buttons: 'BUTTON' });
  for (const item of result.results) {
    expect(item.text).toBe('after');
    expect(item.sameDocument).toBe(true);
    expect(item.namespaces).toEqual([
      item.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml',
    ]);
    if (item.kind === 'html') expect(item.title).toBe('"<&');
  }
});
