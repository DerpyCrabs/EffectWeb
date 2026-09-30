// @vitest-environment happy-dom
import { expect, it } from 'vitest';

it('unmount detaches immediately and close joins replaced, nested and portal work', async () => {
  const result = await (async () => {
    const { lifecycleFixture } = await import('../fixtures/lifecycleFixture');
    return lifecycleFixture();
  })();
  expect(result.detached).toBe(true);
  expect(result.waiting).toBe(true);
  expect(result.events.filter((event) => event.startsWith('closed:')).sort()).toEqual([
    'closed:nested:0',
    'closed:nested:1',
    'closed:portal',
  ]);
});
