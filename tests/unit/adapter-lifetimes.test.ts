// @vitest-environment happy-dom
import { expect, it } from 'vitest';

it('unresolved lazy load joins cleanup with the mount scope', async () => {
  const { lazyScopeCleanup } = await import('../fixtures/adapterLifetimesFixture');
  const root = document.createElement('div');
  document.body.append(root);
  try {
    const result = await lazyScopeCleanup(root);
    expect(result).toEqual({ acquired: true, releases: 1, releasedAtClose: true, pending: true });
  } finally {
    root.remove();
  }
});
