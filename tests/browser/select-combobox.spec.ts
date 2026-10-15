import { expect, test } from '@playwright/test';
async function mountCollections(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/selectComboboxFixture.tsx';
    const { mountSelectComboboxFixture } = (await import(
      path
    )) as typeof import('../fixtures/selectComboboxFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountSelectComboboxFixture(host);
  });
}
test('object multiple select stays open, submits entries, aligns its selected item and resets', async ({
  page,
}) => {
  await mountCollections(page);
  const trigger = page.getByRole('button', { name: 'Letters', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.press('ArrowDown');
  const popup = page.getByRole('listbox', { name: 'Letters list' });
  await expect(popup).toHaveAttribute('aria-multiselectable', 'true');
  await expect(popup).toHaveAttribute('data-side', 'none');
  const triggerBox = await trigger.boundingBox();
  const optionBox = await page.getByRole('option', { name: 'Alpha' }).boundingBox();
  expect(
    Math.abs(triggerBox!.y + triggerBox!.height / 2 - optionBox!.y - optionBox!.height / 2),
  ).toBeLessThan(2);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await expect(trigger).toHaveText('Alpha, Beta');
  expect(
    await page
      .getByRole('form', { name: 'Collection form' })
      .evaluate((el) => new FormData(el as HTMLFormElement).getAll('letters')),
  ).toEqual(['a', 'b']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset collections' }).click();
  await expect(trigger).toHaveText('Alpha');
});
test('combobox keeps input focus, filters, skips disabled items, and publishes ARIA selection', async ({
  page,
}) => {
  await mountCollections(page);
  const input = page.getByRole('combobox', { name: 'Search fruit' });
  await input.fill('a');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('ArrowDown');
  await expect(input).toBeFocused();
  expect(await input.getAttribute('aria-activedescendant')).toBe(
    await page.getByRole('option', { name: 'Apple', exact: true }).getAttribute('id'),
  );
  await input.press('ArrowDown');
  expect(await input.getAttribute('aria-activedescendant')).toBe(
    await page.getByRole('option', { name: 'Banana', exact: true }).getAttribute('id'),
  );
  await input.press('Enter');
  await expect(input).toHaveValue('Banana');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Reset collections' }).click();
  await expect(input).toHaveValue('');
  await input.fill('zz');
  await expect(page.getByText('No fruit', { exact: true })).toBeVisible();
});
test('combobox async source and loading announcements update, multiple chips remove, and creatable items commit', async ({
  page,
}) => {
  await mountCollections(page);
  await page.getByRole('button', { name: 'Load fruit' }).click();
  await expect(page.getByRole('status')).toHaveText('Loading suggestions');
  const input = page.getByRole('combobox', { name: 'Search fruit' });
  await expect(input).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Resolve fruit' }).click();
  await input.fill('D');
  await expect(page.getByRole('option', { name: 'Date', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('2 suggestions available');
  const colors = page.getByRole('combobox', { name: 'Colors' });
  await colors.fill('Red');
  await colors.press('ArrowDown');
  await colors.press('Enter');
  await expect(colors).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Remove Red' })).toBeVisible();
  await colors.fill('Gold');
  await colors.press('Enter');
  await expect(page.getByRole('button', { name: 'Remove Gold' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Red' }).click();
  await expect(page.getByRole('button', { name: 'Remove Red' })).toHaveCount(0);
});
test('autocomplete exposes inline mode and selects only the suggested suffix', async ({ page }) => {
  await mountCollections(page);
  const input = page.getByRole('combobox', { name: 'Inline fruit' });
  await input.fill('Ap');
  await expect(input).toHaveAttribute('aria-autocomplete', 'inline');
  await expect(input).toHaveValue('Apple');
  expect(
    await input.evaluate((el) => [
      (el as HTMLInputElement).selectionStart,
      (el as HTMLInputElement).selectionEnd,
    ]),
  ).toEqual([2, 5]);
  await input.press('Enter');
  await expect(input).toHaveValue('Apple');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});
