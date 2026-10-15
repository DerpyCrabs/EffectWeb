import { expect, test } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/interactiveControlsFixture.tsx';
    const { mountInteractiveControlsFixture } = (await import(
      path
    )) as typeof import('../fixtures/interactiveControlsFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountInteractiveControlsFixture(host);
  });
});
test('slider keyboard precision, range bounds, RTL, vertical, form and controlled wrapper', async ({
  page,
}) => {
  const min = page.getByRole('slider', { name: 'Minimum', exact: true });
  await min.focus();
  await min.press('ArrowRight');
  await expect(min).toHaveAttribute('aria-valuenow', '20.5');
  await min.press('PageUp');
  await expect(min).toHaveAttribute('aria-valuenow', '30.5');
  await min.press('End');
  await expect(min).toHaveAttribute('aria-valuenow', '70');
  await min.press('Home');
  await expect(min).toHaveAttribute('aria-valuenow', '0');
  const rtl = page.getByRole('slider', { name: 'RTL', exact: true });
  await rtl.press('ArrowRight');
  await expect(rtl).toHaveAttribute('aria-valuenow', '39');
  const vertical = page.getByRole('slider', { name: 'Vertical', exact: true });
  await vertical.press('ArrowUp');
  await expect(vertical).toHaveAttribute('aria-valuenow', '31');
  expect(
    await page
      .locator('#controls-form')
      .evaluate((form) => new FormData(form as HTMLFormElement).getAll('range')),
  ).toEqual(['0', '70']);
  await page.getByRole('button', { name: 'Reset controls' }).click();
  await expect(min).toHaveAttribute('aria-valuenow', '20');
  await expect(min).toHaveValue('20');
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('5');
  const styled = page.getByRole('slider', { name: 'Styled volume' });
  await styled.press('ArrowRight');
  await expect(styled).toHaveAttribute('aria-valuenow', '31');
});
test('slider track click and captured pointer drag update nearest thumb', async ({ page }) => {
  const control = page.getByLabel('Range control');
  const box = (await control.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
  await expect(page.getByRole('slider', { name: 'Minimum', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '40',
  );
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.getByRole('slider', { name: 'Minimum', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
});
test('number field localized entry, keyboard, buttons, hold and scrubbing', async ({ page }) => {
  const input = page.getByRole('spinbutton', { name: 'Quantity', exact: true });
  await input.press('ArrowUp');
  await expect(input).toHaveValue('5,5');
  await input.press('PageUp');
  await expect(input).toHaveValue('10,5');
  await input.fill('12,5');
  await input.press('Tab');
  await expect(input).toHaveValue('12,5');
  await page.getByRole('button', { name: 'Increase', exact: true }).first().click();
  await expect(input).toHaveValue('13');
  const scrub = page.getByText('Scrub quantity');
  const box = (await scrub.boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 5);
  await page.mouse.up();
  await expect(input).toHaveValue('18');
  const more = page.getByRole('button', { name: 'Increase', exact: true }).first();
  await more.hover();
  await page.mouse.down();
  await expect
    .poll(async () => Number(await input.getAttribute('aria-valuenow')))
    .toBeGreaterThan(18.5);
  await page.mouse.up();
  const released = await input.getAttribute('aria-valuenow');
  await page.waitForTimeout(250);
  await expect(input).toHaveAttribute('aria-valuenow', released!);
  await input.press('End');
  await expect(input).toHaveValue('100');
  await expect(more).toBeDisabled();
  await input.press('Home');
  await expect(input).toHaveValue('0');
});
test('scroll viewport keyboard, wheel, resize and captured thumb drag', async ({ page }) => {
  const viewport = page.getByLabel('Scrollable content');
  await viewport.focus();
  await viewport.press('PageDown');
  expect(await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  await viewport.press('Home');
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(0);
  const thumb = page.locator('[aria-label="Vertical scrollbar"] [data-scroll-thumb]');
  const box = (await thumb.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + 3, box.y + 65);
  await page.mouse.up();
  expect(await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(250);
  await viewport.hover();
  const before = await viewport.evaluate((el) => el.scrollTop);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await viewport.evaluate((el) => {
    (el.firstElementChild as HTMLElement).style.height = '1800px';
  });
  await expect
    .poll(() => thumb.evaluate((el) => el.getBoundingClientRect().height))
    .toBeLessThan(22);
});
test('toolbar roving focus skips disabled and keeps text editing keys', async ({ page }) => {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await undo.focus();
  await undo.press('ArrowRight');
  await expect(page.getByRole('link', { name: 'Tools' })).toBeFocused();
  await page.keyboard.press('End');
  const input = page.getByRole('textbox', { name: 'Tool filter' });
  await expect(input).toBeFocused();
  await input.fill('abc');
  await input.press('Home');
  await expect(input).toBeFocused();
  await page.getByRole('link', { name: 'Tools' }).press('Home');
  await expect(undo).toBeFocused();
});
test('toast queues, pauses on hover and focus, closes and promotes', async ({ page }) => {
  await page.getByRole('button', { name: 'Notify', exact: true }).click();
  const first = page.getByRole('status', { name: 'First notification' });
  await expect(first).toBeVisible();
  await first.hover();
  await page.waitForTimeout(1400);
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).focus();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1400);
  await expect(first).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(first).toHaveCount(0);
  const second = page.getByRole('status', { name: 'Second notification' });
  await expect(second).toBeVisible();
  await page.getByRole('button', { name: 'Notify', exact: true }).focus();
  await page.mouse.move(5, 5);
  await expect(second).toHaveCount(0, { timeout: 3000 });
});
test('sidebar collapse, shortcut, mobile modal and semantic compositions', async ({ page }) => {
  const trigger = page.locator('[data-slot=sidebar-trigger]');
  const sidebar = page.locator('[data-slot=sidebar]');
  await trigger.click();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await expect(sidebar).toHaveAttribute('data-collapsible', 'icon');
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  await expect(page.locator('article[data-slot=card]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Semantic card', level: 2 })).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeHidden();
});

test('pointer handlers can cancel changes and styled slider has visible geometry', async ({
  page,
}) => {
  const control = page.getByLabel('Range control');
  const box = (await control.boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + box.width * 0.4, box.y + 15);
  await page.keyboard.up('Alt');
  await expect(page.getByRole('slider', { name: 'Minimum', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '20',
  );
  const scrub = (await page.getByText('Scrub quantity').boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(scrub.x + 5, scrub.y + 5);
  await page.mouse.down();
  await page.mouse.move(scrub.x + 45, scrub.y + 5);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('5');
  expect(
    await page
      .locator('[data-slot=slider-track]')
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(0);
  expect(
    await page
      .locator('[data-slot=slider-range]')
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(0);
});
test('auto scrollbars show activity, hide after leaving, and expose gutter mode', async ({
  page,
}) => {
  const bar = page.getByTestId('auto-bar');
  await expect(bar).toHaveAttribute('data-hidden', '');
  const area = page.getByLabel('Auto scroll area');
  await expect(area).toHaveAttribute('data-mode', 'gutter');
  await area.hover();
  await expect(bar).toHaveAttribute('data-visible', '');
  await page.mouse.move(5, 5);
  await expect(bar).toHaveAttribute('data-hidden', '');
});
test('toast window blur pauses time and sonner follows dark class changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Notify', exact: true }).click();
  await page.mouse.move(5, 5);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(1400);
  await expect(page.getByRole('status', { name: 'First notification' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status', { name: 'First notification' })).toHaveCount(0, {
    timeout: 2500,
  });
  await page.getByRole('button', { name: 'Styled notify', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Styled notification' })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await expect(page.locator('[data-theme]')).toHaveAttribute('data-theme', 'light');
});
