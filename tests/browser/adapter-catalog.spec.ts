import { expect, test } from '@playwright/test';
test('questionnaire, grouped input, chart, copyable lines, two-tone paint and transcript navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/adapterCatalogFixture.tsx';
    const { mountCatalog } = (await import(
      path
    )) as typeof import('../fixtures/adapterCatalogFixture');
    mountCatalog(document.body);
  });
  const city = page.getByRole('textbox', { name: 'City' });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(city).toBeFocused();
  await city.fill('Brno');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Review', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(city).toHaveValue('Brno');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-answer', 'Brno');
  await page.getByText('Search', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search field' })).toBeFocused();
  await expect(page.locator('[data-slot="code-block-line"]')).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Sales' }).locator('rect')).toHaveCount(1);
  const paint = await page
    .getByRole('img', { name: 'Favorite' })
    .locator('path')
    .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).fill));
  expect(new Set(paint)).toEqual(new Set(['rgb(255, 0, 0)', 'rgb(0, 0, 255)']));
  const viewport = page.locator('[data-slot="message-scroller-viewport"]');
  await expect.poll(() => viewport.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Scroll to start' }).click();
  await expect.poll(() => viewport.evaluate((e) => e.scrollTop)).toBe(0);
});
