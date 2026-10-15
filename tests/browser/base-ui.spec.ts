import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/baseUiFixture.tsx';
    const { mountBaseUiFixture } = (await import(
      path
    )) as typeof import('../fixtures/baseUiFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountBaseUiFixture(host);
  });
  await expect(page.getByRole('button', { name: 'Open dialog', exact: true })).toBeVisible();
});
test('dialog and alert dialog use independent parts, modal focus and escape policy', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'Open dialog', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Headless dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-open', '');
  await page.getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Dialog text' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Open alert', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
});
test('popover dismisses outside and exposes positioning variables; tooltip describes its trigger', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open popover' }).click();
  const popup = page.getByRole('dialog', { name: 'Details' });
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-side', 'right');
  expect(await popup.evaluate((el) => el.style.getPropertyValue('--anchor-width'))).toMatch(/px$/);
  await page.locator('#outside').click();
  await expect(popup).toBeHidden();
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await help.getAttribute('aria-describedby')).toBe(
    await page.getByRole('tooltip').getAttribute('id'),
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
});
test('menu roves, typeaheads, opens and closes a submenu with arrow keys', async ({ page }) => {
  await page.getByRole('button', { name: 'Open menu' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Apple', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Banana' })).toBeFocused();
  await page.keyboard.press('a');
  await expect(page.getByRole('menuitem', { name: 'Apple', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: 'Submenu', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Nested action' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menuitem', { name: 'More' })).toBeFocused();
  await expect(page.getByRole('menu', { name: 'Actions', exact: true })).toBeVisible();
});
test('custom select has listbox semantics, skips disabled options, selects with keyboard and restores focus', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'Fruit', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Apple', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Banana' })).toBeFocused();
  await page.keyboard.press('c');
  await expect(page.getByRole('option', { name: 'Cherry' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(trigger).toHaveText('Cherry');
  await expect(trigger).toBeFocused();
});
test('tabs, disclosures and accordion expose relationships and keyboard state', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Tab one' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Tab two' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveText('Second panel');
  await page.getByRole('button', { name: 'Disclosure', exact: true }).click();
  await expect(page.getByText('Disclosure content')).toBeVisible();
  await page.getByRole('button', { name: 'Section one', exact: true }).click();
  await expect(page.getByText('Accordion one')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Accordion one')).toBeHidden();
  await expect(page.getByText('Accordion two')).toBeVisible();
});
test('form controls, toggle groups, field validation and static semantics', async ({ page }) => {
  const check = page.getByRole('checkbox', { name: 'Check', exact: true });
  await expect(check).toHaveAttribute('aria-checked', 'mixed');
  await check.press('Space');
  await expect(check).toBeChecked();
  const sw = page.getByRole('switch');
  await sw.press('Space');
  await expect(sw).toBeChecked();
  await page.getByRole('radio', { name: 'Radio one' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Radio two' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Italic' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Underline' })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Underline' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('textbox', { name: 'Email' }).fill('bad');
  await page.locator('#outside').focus();
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('alert')).toHaveText('Enter an email');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await expect(page.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(page.getByText('AB', { exact: true })).toBeVisible();
});

test('menu check and radio items retain state and ArrowUp starts at the end', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Open menu' });
  await trigger.click();
  await page.getByRole('menuitemcheckbox', { name: 'Flag' }).click();
  await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Flag' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Radio choice' }).click();
  await trigger.click();
  await expect(page.getByRole('menuitemradio', { name: 'Radio choice' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await trigger.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'More' })).toBeFocused();
});
