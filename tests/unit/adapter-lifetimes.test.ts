// @vitest-environment happy-dom
import { expect, it } from 'vitest';

for (const explicitRuntime of [false, true]) {
  it(`unresolved lazy load joins cleanup with ${explicitRuntime ? 'explicit' : 'ambient'} runtime`, async () => {
    const result = await (async (explicitRuntime) => {
      const { lazyScopeCleanup } = await import('../fixtures/adapterLifetimesFixture');
      const root = document.createElement('div');
      document.body.append(root);
      try {
        return await lazyScopeCleanup(root, explicitRuntime);
      } finally {
        root.remove();
      }
    })(explicitRuntime);
    expect(result).toEqual({ acquired: true, releases: 1, releasedAtClose: true, pending: true });
  });
}
