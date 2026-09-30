// @vitest-environment happy-dom
import { expect, it } from 'vitest';

it('failed mounting joins child release before releasing view dependencies', async () => {
  const result = await (async () => {
    const { failedRenderCleanup } = await import('../fixtures/mountLifecycleFixture');
    const parent = document.createElement('div');
    document.body.append(parent);
    const result = await failedRenderCleanup(parent);
    parent.remove();
    return result;
  })();
  expect(result).toEqual({
    result: 'Failure',
    whileClosing: ['child release started'],
    pending: true,
    after: ['child release started', 'child released', 'view dependency'],
    empty: true,
  });
});

for (const action of ['close', 'dispose', 'reentrant-dispose', 'failure', 'interrupt'] as const) {
  it(`${action} preserves the first closing exit and joins DOM and view cleanup once`, async () => {
    const result = await (async (action) => {
      const { mountClosingExit } = await import('../fixtures/mountLifecycleFixture');
      const parent = document.createElement('div');
      document.body.append(parent);
      const result = await mountClosingExit(parent, action);
      parent.remove();
      return result;
    })(action);
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

it('the cache joins retained query scopes before its parent closes', async () => {
  const result = await (async () => {
    const { queryScopeCleanup } = await import('../fixtures/mountLifecycleFixture');
    return await queryScopeCleanup();
  })();
  expect(result).toEqual({ retained: true, pending: true, releasedBeforeParentClose: 1 });
});
