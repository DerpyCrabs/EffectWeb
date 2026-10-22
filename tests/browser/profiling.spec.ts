import { expect, test } from '@playwright/test';
import type { installProfiler } from '../../packages/runtime/src/profiling';
declare global {
  interface Window {
    __EFFECTWEB_PROFILE__: ReturnType<typeof installProfiler>;
  }
}
test('agent captures source-located updates through the installed JSON browser API', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?effectweb-profile=1');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/profilingFixture.tsx';
    const fixture = (await import(path)) as typeof import('../fixtures/profilingFixture');
    fixture.profilingFixture(document.body);
  });
  await page.getByRole('button').click();
  await expect(page.getByRole('button')).toHaveText('first:1');
  const report = await page.evaluate(() => window.__EFFECTWEB_PROFILE__.stop());
  expect(report.schemaVersion).toBe(1);
  expect(
    report.entries.some(
      (e) =>
        e.kind === 'view' && e.calls === 2 && e.location?.file.endsWith('profilingFixture.tsx'),
    ),
  ).toBe(true);
  expect(
    report.entries.some(
      (e) => e.kind === 'projection' && e.location?.file.endsWith('profilingFixture.tsx'),
    ),
  ).toBe(true);
  expect(report.events.some((e) => e.cause.includes('count'))).toBe(true);
  expect(report.active).toBe(false);
  expect(errors).toEqual([]);
});
