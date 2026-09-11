import { expect, test } from '@playwright/test';

test('explicit row projections render only changed rows while preserving keyed DOM identity', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/scopedRenderingFixture.tsx';
    const { mountScopedRendering } = (await import(
      path
    )) as typeof import('../fixtures/scopedRenderingFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = await mountScopedRendering(host);
    const before = fixture.evaluations();
    const buttons = [...host.querySelectorAll('button')];
    const mutations = new MutationObserver(() => {});
    mutations.observe(host, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    fixture.send({ type: 'select', id: 500 });
    const result = {
      mutations: mutations.takeRecords().length,
      initial: before,
      updated: fixture.evaluations() - before,
      selected: host.querySelector('.selected')?.getAttribute('data-id'),
      stable: buttons.every((node, index) => node === host.querySelectorAll('button')[index]),
    };
    mutations.disconnect();
    await fixture.close();
    host.remove();
    return result;
  });
  expect(result).toEqual({
    mutations: 2,
    initial: 1000,
    updated: 2,
    selected: '500',
    stable: true,
  });
});

test('Effect setup supplies event services and owns DOM resources and isolated observations', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/scopedRenderingFixture.tsx';
    const { mountEffectSetup } = (await import(
      path
    )) as typeof import('../fixtures/scopedRenderingFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = await mountEffectSetup(host);
    await Promise.resolve();
    const before = fixture.projections();
    await fixture.updateUnrelated();
    const unrelated = fixture.projections() - before;
    host.querySelector('button')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const text = host.textContent;
    await fixture.closeMount();
    const releasedOnUnmount = [...fixture.releases];
    await fixture.close();
    const empty = !host.childNodes.length;
    host.remove();
    return { unrelated, text, releasedOnUnmount, empty };
  });
  expect(result).toEqual({
    unrelated: 0,
    text: '5',
    releasedOnUnmount: ['dom', 'view'],
    empty: true,
  });
});

test('components, tasks, resources and lazy views inherit the mounted application context', async ({
  page,
}) => {
  await page.goto('/');
  const labels = await page.evaluate(async () => {
    const path = '/tests/fixtures/scopedRenderingFixture.tsx';
    const { mountInheritedContext } = (await import(
      path
    )) as typeof import('../fixtures/scopedRenderingFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const close = await mountInheritedContext(host);
    host.querySelector<HTMLButtonElement>('#ambient-component')!.click();
    host.querySelector<HTMLButtonElement>('#ambient-task')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const labels = [...host.children].map((node) => node.textContent);
    await close();
    host.remove();
    return labels;
  });
  expect(labels).toEqual(['application', 'application', 'application', 'application']);
});

test('an observation removed during synchronous subscription releases that subscription', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/scopedRenderingFixture.tsx';
    const { checkObservationDisposal } = (await import(
      path
    )) as typeof import('../fixtures/scopedRenderingFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const result = await checkObservationDisposal(host);
    host.remove();
    return result;
  });
  expect(result).toEqual({ beforeClose: 1, afterClose: 1 });
});
