import { expect, test } from '@playwright/test';

test('failed mounting joins child release before releasing view dependencies', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/mountLifecycleFixture.tsx';
    const { failedRenderCleanup } = (await import(
      path
    )) as typeof import('../fixtures/mountLifecycleFixture');
    const parent = document.createElement('div');
    document.body.append(parent);
    const result = await failedRenderCleanup(parent);
    parent.remove();
    return result;
  });
  expect(result).toEqual({
    result: 'Failure',
    whileClosing: ['child release started'],
    pending: true,
    after: ['child release started', 'child released', 'view dependency'],
    empty: true,
  });
});

for (const action of ['close', 'dispose', 'reentrant-dispose', 'failure', 'interrupt'] as const) {
  test(`${action} preserves the first closing exit and joins DOM and view cleanup once`, async ({
    page,
  }) => {
    await page.goto('/');
    const result = await page.evaluate(async (action) => {
      const path = '/tests/fixtures/mountLifecycleFixture.tsx';
      const { mountClosingExit } = (await import(
        path
      )) as typeof import('../fixtures/mountLifecycleFixture');
      const parent = document.createElement('div');
      document.body.append(parent);
      const result = await mountClosingExit(parent, action);
      parent.remove();
      return result;
    }, action);
    const exit =
      action === 'failure'
        ? 'application failed'
        : action === 'interrupt'
          ? 'interrupted'
          : 'success';
    expect(result).toEqual({
      whileClosing: ['DOM release started'],
      bothPending: true,
      detached: true,
      after: ['DOM release started', 'DOM released', 'view released'],
      exits: [
        { owner: 'DOM', exit },
        { owner: 'view', exit },
      ],
      unsubscriptions: 1,
    });
  });
}

test('the cache joins retained query scopes before its parent closes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/mountLifecycleFixture.tsx';
    const { queryScopeCleanup } = (await import(
      path
    )) as typeof import('../fixtures/mountLifecycleFixture');
    return await queryScopeCleanup();
  });
  expect(result).toEqual({ retained: true, pending: true, releasedBeforeParentClose: 1 });
});
