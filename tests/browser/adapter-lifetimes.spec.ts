import { expect, test } from '@playwright/test';

for (const explicitRuntime of [false, true]) {
  test(`unresolved lazy load joins cleanup with ${explicitRuntime ? 'explicit' : 'ambient'} runtime`, async ({
    page,
  }) => {
    await page.goto('/');
    const result = await page.evaluate(async (explicitRuntime) => {
      const path = '/tests/fixtures/adapterLifetimesFixture.ts';
      const { lazyScopeCleanup } = (await import(
        path
      )) as typeof import('../fixtures/adapterLifetimesFixture');
      const root = document.createElement('div');
      document.body.append(root);
      try {
        return await lazyScopeCleanup(root, explicitRuntime);
      } finally {
        root.remove();
      }
    }, explicitRuntime);
    expect(result).toEqual({ acquired: true, releases: 1, releasedAtClose: true, pending: true });
  });
}
