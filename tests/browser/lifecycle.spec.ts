import { expect, test } from '@playwright/test';

test('unmount detaches immediately and close joins replaced, nested and portal work', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/lifecycleFixture.tsx';
    const { lifecycleFixture } = (await import(
      path
    )) as typeof import('../fixtures/lifecycleFixture');
    return lifecycleFixture();
  });
  expect(result.detached).toBe(true);
  expect(result.waiting).toBe(true);
  expect(result.events.filter((event) => event.startsWith('closed:')).sort()).toEqual([
    'closed:nested:0',
    'closed:nested:1',
    'closed:portal',
  ]);
});
