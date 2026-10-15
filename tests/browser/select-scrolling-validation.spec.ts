import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/selectScrollingValidationFixture.tsx';
    const { mountSelectScrollingValidationFixture } = (await import(
      path
    )) as typeof import('../fixtures/selectScrollingValidationFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountSelectScrollingValidationFixture(host);
  });
});
test('Select Positioner opts out of alignment, paging reaches ends, and hover arrows scroll', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'Long select' });
  await trigger.press('ArrowDown');
  const popup = page.getByRole('listbox', { name: 'Long list' });
  await expect(popup).toHaveAttribute('data-side', 'bottom');
  await page.keyboard.press('PageDown');
  await expect(page.getByRole('option', { name: 'Item 29', exact: true })).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(page.getByRole('option', { name: 'Item 0', exact: true })).toBeFocused();
  const before = await popup.evaluate((el) => el.scrollTop);
  await page.getByTestId('scroll-down').hover();
  await expect.poll(() => popup.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
test('empty required selection blocks submission and directs validation focus to the trigger', async ({
  page,
}) => {
  expect(
    await page
      .getByRole('form', { name: 'Required form' })
      .evaluate((el) => (el as HTMLFormElement).checkValidity()),
  ).toBe(false);
  await page.getByRole('button', { name: 'Submit required' }).click();
  await expect(page.getByRole('button', { name: 'Required choice' })).toBeFocused();
});
