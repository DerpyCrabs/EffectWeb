import { expect, test } from '@playwright/test';
test('styled collection parts provide input adornments, selected indicators and stable keyboard behavior', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/collectionsStyledFixture.tsx';
    const { mountStyledCollections } = (await import(
      path
    )) as typeof import('../fixtures/collectionsStyledFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountStyledCollections(host);
  });
  const trigger = page.getByRole('button', { name: 'Styled fruit' });
  await trigger.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Pear');
  await expect(trigger).toBeFocused();
  await trigger.click();
  const selected = page.getByRole('option', { name: 'Pear', exact: true });
  await expect(selected.locator('svg')).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'Apple', exact: true }).locator('svg'),
  ).toBeHidden();
  await page.keyboard.press('Escape');
  const input = page.getByRole('combobox', { name: 'Styled search' });
  await page.getByRole('button', { name: 'Open suggestions' }).click();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Open suggestions' }).click();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Open suggestions' }).click();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('Apple');
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(input).toHaveValue('');
  const group = page.locator('[data-slot=input-group]');
  const adornment = page.getByRole('button', { name: 'Open suggestions' });
  await expect
    .poll(async () => {
      const groupBox = (await group.boundingBox())!;
      const buttonBox = (await adornment.boundingBox())!;
      return Math.abs(groupBox.y + groupBox.height / 2 - buttonBox.y - buttonBox.height / 2);
    })
    .toBeLessThan(2);
  const inputBox = (await input.boundingBox())!;
  const buttonBox = (await adornment.boundingBox())!;
  const groupBox = (await group.boundingBox())!;
  expect(buttonBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(groupBox.x + groupBox.width);
});
