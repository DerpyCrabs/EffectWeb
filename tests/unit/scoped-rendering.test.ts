// @vitest-environment happy-dom
import { expect, it } from 'vitest';

it('explicit row projections render only changed rows while preserving keyed DOM identity', async () => {
  const result = await (async () => {
    const { mountScopedRendering } = await import('../fixtures/scopedRenderingFixture');
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
  })();
  expect(result).toEqual({
    mutations: 2,
    initial: 1000,
    updated: 2,
    selected: '500',
    stable: true,
  });
});

it('components, tasks and lazy views inherit the mounted application context', async () => {
  const labels = await (async () => {
    const { mountInheritedContext } = await import('../fixtures/scopedRenderingFixture');
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
  })();
  expect(labels).toEqual(['application', 'application', 'application']);
});

it('an observation removed during synchronous subscription releases that subscription', async () => {
  const result = await (async () => {
    const { checkObservationDisposal } = await import('../fixtures/scopedRenderingFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const result = await checkObservationDisposal(host);
    host.remove();
    return result;
  })();
  expect(result).toEqual({ beforeClose: 1, afterClose: 1 });
});
