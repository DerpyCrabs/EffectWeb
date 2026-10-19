import { expect, test, type Locator, type Page } from '@playwright/test';

// The shadcn port on native elements: the browser owns focus trapping, light dismiss and Escape; the components
// own placement, roving focus and reporting. Tailwind is wired through the fixture's CSS, so computed styles prove
// the theme classes resolve.

const state = async (page: Page) =>
  JSON.parse((await page.locator('#state').textContent()) ?? '{}') as Record<string, unknown>;
/** Entrance animations move the box; measure after they end. */
const settled = (locator: Locator) =>
  locator.evaluate((element) =>
    Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/shadcnFixture.tsx';
    const { mountShadcnFixture } = (await import(
      path
    )) as typeof import('../fixtures/shadcnFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountShadcnFixture(host);
  });
  await expect(page.locator('#badge')).toBeVisible();
});

test('the theme reaches the elements: a primary button is painted with the primary token', async ({
  page,
}) => {
  const button = page.locator('#open-dialog');
  const colors = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    };
  });
  expect(colors.primary).toBe('oklch(0% 0 0)');
  expect(colors.background).toMatch(/oklch\(0 0 0\)|rgb\(0, 0, 0\)/);
  expect(colors.radius).not.toBe('0px');
});

test('dialog: opens as a modal, traps focus, closes on Escape, the footer button and the backdrop; the model follows', async ({
  page,
}) => {
  await page.locator('#open-dialog').click();
  const dialog = page.locator('dialog[data-slot=dialog]');
  await expect(dialog).toBeVisible();
  expect((await state(page)).dialog).toBe(true);
  await expect(dialog.getByRole('heading', { name: 'A dialog' })).toBeVisible();
  // Named by its title and described by its description, so assistive technology announces both.
  await expect(page.getByRole('dialog', { name: 'A dialog', exact: true })).toHaveAttribute(
    'aria-describedby',
    /.+/,
  );
  const first = page.locator('#dialog-input');
  const last = dialog.getByRole('button', { name: 'Close', exact: true });
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await first.fill('typed');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The close event is queued after the dialog closes, so the model is read with a poll.
  await expect.poll(async () => (await state(page)).dialog).toBe(false);
  await page.locator('#open-dialog').click();
  await page.locator('#dialog-ok').click();
  await expect(dialog).toBeHidden();
  await page.locator('#open-dialog').click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await state(page)).dialog).toBe(false);
});

test('alert dialog: Escape and the backdrop do not close it; the action runs and closes', async ({
  page,
}) => {
  await page.locator('#open-alert').click();
  const dialog = page.locator('dialog[data-slot=alert-dialog]');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Sure?' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog).toBeHidden();
  expect((await state(page)).log).toEqual(['confirmed']);
});

test('sheet: slides in from the right and closes with its close button', async ({ page }) => {
  await page.locator('#open-sheet').click();
  const sheet = page.locator('dialog[data-slot=sheet]');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#sheet-body')).toBeVisible();
  const box = (await sheet.boundingBox())!;
  const width = await page.evaluate(() => window.innerWidth);
  expect(box.x + box.width).toBeGreaterThan(width - 2);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});

test('tooltip: shows on hover and focus, is placed above the trigger, hides on leave', async ({
  page,
}) => {
  const trigger = page.locator('#tip-trigger');
  const tip = page.getByRole('tooltip');
  await trigger.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText('Help text');
  await settled(tip);
  const [tipBox, triggerBox] = [await tip.boundingBox(), await trigger.boundingBox()];
  expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(triggerBox!.y);
  expect(await trigger.getAttribute('aria-describedby')).toBe(await tip.getAttribute('id'));
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  await trigger.focus();
  await expect(tip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
});

test('popover: toggles from its trigger, sits below it, closes on Escape and outside clicks', async ({
  page,
}) => {
  const trigger = page.locator('#pop-trigger');
  const content = page.locator('#pop-content');
  await trigger.click();
  await expect(content).toBeVisible();
  expect((await state(page)).popover).toBe(true);
  await settled(page.locator('[data-slot=popover-content]'));
  const [popBox, triggerBox] = [
    await page.locator('[data-slot=popover-content]').boundingBox(),
    await trigger.boundingBox(),
  ];
  expect(popBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
  await page.keyboard.press('Escape');
  await expect(content).toBeHidden();
  expect((await state(page)).popover).toBe(false);
  await trigger.click();
  await expect(content).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(content).toBeHidden();
  await trigger.click();
  await trigger.click();
  await expect(content).toBeHidden();
});

test('dropdown menu: opens on click or arrow, focuses the first item, arrows skip disabled items, Enter selects and closes', async ({
  page,
}) => {
  const trigger = page.locator('#menu-trigger');
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'First' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Checked' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'First' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  expect((await state(page)).log).toEqual(['delete']);
  await trigger.click();
  const checkbox = page.getByRole('menuitemcheckbox', { name: 'Checked' });
  await checkbox.click();
  await expect(menu).toBeVisible();
  await expect(checkbox).toBeFocused();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  expect((await state(page)).checked).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Checked' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('tabs: clicks and arrow keys select, disabled tabs are skipped, only the active panel exists', async ({
  page,
}) => {
  await expect(page.locator('#panel-one')).toBeVisible();
  await expect(page.locator('#panel-two')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Two' }).click();
  await expect(page.locator('#panel-two')).toBeVisible();
  expect((await state(page)).tab).toBe('two');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Four' })).toBeFocused();
  await expect(page.locator('#panel-four')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  expect((await state(page)).tab).toBe('four');
});

test('checkbox, switch and native select report through their change events', async ({ page }) => {
  await page.locator('#check').click();
  expect((await state(page)).checked).toBe(true);
  await expect(page.locator('[data-slot=checkbox]')).toHaveAttribute('data-state', 'checked');
  await page.locator('#switch').click();
  expect((await state(page)).on).toBe(true);
  await page.locator('#select').selectOption('b');
  expect((await state(page)).select).toBe('b');
  await page.locator('#check').focus();
  await page.keyboard.press('Space');
  expect((await state(page)).checked).toBe(false);
});

test('accordion and collapsible: native details report opening and closing; the accordion keeps one open', async ({
  page,
}) => {
  // The toggle event is dispatched after the attribute changes, so the model is read with a poll.
  await page.getByText('Section X').click();
  await expect(page.locator('#acc-x')).toBeVisible();
  await expect.poll(async () => (await state(page)).open).toEqual(['x']);
  await page.getByText('Section Y').click();
  await expect(page.locator('#acc-y')).toBeVisible();
  await expect(page.locator('#acc-x')).toBeHidden();
  await expect.poll(async () => (await state(page)).open).toEqual(['y']);
  await page.locator('#coll-trigger').click();
  await expect(page.locator('#coll-content')).toBeVisible();
  await expect.poll(async () => (await state(page)).collapsed).toBe(true);
});

test('custom select shares controlled values with native select; hover card retains interactive content', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'Custom choice' });
  await trigger.click();
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('Beta');
  await expect(page.locator('#select')).toHaveValue('b');
  await page.locator('#select').selectOption('a');
  await expect(trigger).toHaveText('Alpha');
  await page.locator('#hover-trigger').hover();
  await expect(page.locator('#hover-action')).toBeVisible();
  await page.locator('#hover-action').hover();
  await expect(page.locator('#hover-action')).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.locator('#hover-action')).toBeHidden();
});
