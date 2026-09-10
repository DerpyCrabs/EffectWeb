import { expect, test } from '@playwright/test';

test('equal presentation values leave nested markup and text untouched', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { Scope, view, markup } = (await import(path)) as typeof import('../fixtures/runtime');
    const host = document.createElement('div');
    const row = markup('span');
    const panel = markup('section');
    const scope = new Scope({ label: 'same' }, () => {});
    const View = view<{ label: string }>((model) =>
      panel({
        title: model.label,
        children: [row({ children: model.label }), row({ children: null })],
      }),
    );
    View.build(scope, host, null);
    const observer = new MutationObserver(() => {});
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    scope.set({ label: 'same' });
    const mutations = observer.takeRecords().map((record) => record.type);
    scope.set({ label: 'changed' });
    const text = host.textContent;
    observer.disconnect();
    scope.dispose();
    return { mutations, text };
  });
  expect(result).toEqual({ mutations: [], text: 'changed' });
});

test('keyed rows receive the supplied item when an equal replacement retains its DOM identity', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { Scope, each, element, entities } = (await import(
      path
    )) as typeof import('../fixtures/runtime');
    const old = { id: 1, label: 'same' };
    const next = { ...old };
    const scope = new Scope(entities([old]), () => {});
    const host = document.createElement('div');
    let received = old;
    each(
      scope,
      host,
      null,
      () => scope.value,
      () => [],
      false,
      (row, parent, before) => {
        element(parent, before, 'span');
        row.jobs.push(() => {
          received = row.value[0];
        });
      },
    );
    const first = host.querySelector('span');
    scope.set(entities([next]));
    const result = { exact: received === next, stable: first === host.querySelector('span') };
    scope.dispose();
    return result;
  });
  expect(result).toEqual({ exact: true, stable: true });
});

test('selection skips unchanged list identities and unchanged class values while captures stay fresh', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/listOptimizationFixture.tsx';
    const { mountListOptimization } = (await import(
      path
    )) as typeof import('../fixtures/listOptimizationFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = mountListOptimization(host);
    const buttons = [...host.querySelectorAll('button')];
    const get = Object.getOwnPropertyDescriptor(Element.prototype, 'getAttribute')!;
    const originalGet = get.value as typeof Element.prototype.getAttribute;
    let classReads = 0;
    Element.prototype.getAttribute = function (name) {
      if (name === 'class' && this.tagName === 'BUTTON') classReads++;
      return originalGet.call(this, name);
    };
    try {
      const identities = fixture.counters.identities;
      fixture.send({ selected: 500 });
      const selected = [...host.querySelectorAll('.selected')].map((node) =>
        node.getAttribute('data-id'),
      );
      const selection = {
        identities: fixture.counters.identities - identities,
        classReads,
        selected,
        stable: buttons.every((button, index) => button === host.querySelectorAll('button')[index]),
      };
      fixture.send({ items: [...fixture.model().items].reverse() });
      fixture.send({ suffix: 'after' });
      buttons[500]!.click();
      const clicked = fixture.model().clicked;
      fixture.send({ items: fixture.model().items.map((item) => ({ ...item, label: 'new' })) });
      buttons[500]!.click();
      return { selection, clicked, updated: fixture.model().clicked };
    } finally {
      Object.defineProperty(Element.prototype, 'getAttribute', get);
      fixture.dispose();
      host.remove();
    }
  });
  expect(result).toEqual({
    selection: { identities: 0, classReads: 2, selected: ['500'], stable: true },
    clicked: 'row 500:499:after',
    updated: 'new:499:after',
  });
});

for (const layout of ['whole', 'prefix', 'suffix', 'both', 'multiple-roots'] as const) {
  test(`clearing ${layout} lists disposes rows, preserves siblings and supports repopulation`, async ({
    page,
  }) => {
    await page.goto('/');
    const result = await page.evaluate(async (layout) => {
      const path = '/tests/fixtures/runtime.ts';
      const { Scope, each, element, event } = (await import(
        path
      )) as typeof import('effectweb/dom');
      const host = document.createElement('div');
      document.body.append(host);
      const prefix = layout === 'prefix' || layout === 'both';
      const suffix = layout === 'suffix' || layout === 'both';
      if (prefix) element(host, null, 'header').textContent = 'before';
      const after = suffix ? element(host, null, 'footer') : null;
      if (after) after.textContent = 'after';
      let clicks = 0;
      const disposed: number[] = [];
      const connected: boolean[] = [];
      const errors: unknown[] = [];
      const scope = new Scope<readonly number[], never>(
        [1, 2, 3],
        () => {},
        (e) => errors.push(e),
      );
      each(
        scope,
        host,
        after,
        () => scope.value,
        () => [],
        false,
        (row, parent, before) => {
          const button = element(parent, before, 'button');
          button.textContent = String(row.value[0]);
          event(row, button, 'onClick', () => {
            clicks++;
          });
          row.cleanups.push(() => {
            disposed.push(row.value[0]);
            connected.push(button.isConnected);
            if (row.value[0] === 2) throw new Error('cleanup still releases other rows');
          });
          if (layout === 'multiple-roots') element(parent, before, 'span').textContent = 'extra';
        },
      );
      const old = host.querySelector('button')!;
      // Move the first row before clearing, so map insertion order differs from DOM order.
      scope.set([3, 2, 1]);
      const observer = new MutationObserver(() => {});
      observer.observe(host, { childList: true });
      scope.set([]);
      const records = observer.takeRecords();
      observer.disconnect();
      old.click();
      const cleared = {
        text: host.textContent,
        buttons: host.querySelectorAll('button').length,
        siblings:
          (!prefix || host.firstChild?.nodeName === 'HEADER') &&
          (!suffix || host.lastChild === after),
        clicks,
        removals: records.filter((record) => record.removedNodes.length).length,
      };
      scope.set([4, 5]);
      host.querySelector('button')!.click();
      const repopulated = [...host.querySelectorAll('button')].map((node) => node.textContent);
      scope.dispose();
      host.querySelector('button')!.click();
      host.remove();
      return { cleared, repopulated, clicks, disposed, connected, errors: errors.length };
    }, layout);
    expect(result).toEqual({
      cleared: {
        text: `${layout === 'prefix' || layout === 'both' ? 'before' : ''}${layout === 'suffix' || layout === 'both' ? 'after' : ''}`,
        buttons: 0,
        siblings: true,
        clicks: 0,
        removals: layout === 'whole' || layout === 'multiple-roots' ? 1 : 3,
      },
      repopulated: ['4', '5'],
      clicks: 1,
      disposed: [1, 2, 3, 4, 5],
      connected: [true, true, true, true, true],
      errors: 1,
    });
  });
}
