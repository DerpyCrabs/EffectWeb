import { expect, test } from '@playwright/test';
test.describe('menu families', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const path = '/tests/fixtures/menuFamiliesFixture.tsx';
      const { mountMenuFamiliesFixture } = (await import(
        path
      )) as typeof import('../fixtures/menuFamiliesFixture');
      const host = document.createElement('div');
      document.body.append(host);
      mountMenuFamiliesFixture(host);
    });
  });
  test('context pointer position, nested interaction tree, Escape and outside dismissal', async ({
    page,
  }) => {
    const target = page.getByText('Context target', { exact: true });
    await target.click({ button: 'right', position: { x: 35, y: 25 } });
    const popup = page.getByRole('menu', { name: 'Context actions', exact: true });
    await expect(popup).toBeVisible();
    await expect(target).toHaveAttribute('aria-haspopup', 'menu');
    await expect(target).toHaveAttribute('aria-expanded', 'true');
    const anchor = await target.boundingBox();
    await expect
      .poll(async () => Math.abs((await popup.boundingBox())!.x - (anchor!.x + 35)))
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => Math.abs((await popup.boundingBox())!.y - (anchor!.y + 25)))
      .toBeLessThanOrEqual(1);
    await expect(page.getByRole('menuitem', { name: 'Context first' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: 'Context deeper' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: 'Context leaf' })).toBeFocused();
    await expect(popup).toBeVisible();
    await page.getByRole('menuitem', { name: 'Context leaf' }).click();
    await expect(popup).toBeHidden();
    await expect(target).toBeFocused();
    await target.press('Shift+F10');
    await expect(popup).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(target).toBeFocused();
    await target.press('ContextMenu');
    await expect(popup).toBeVisible();
    await page.locator('#menus-outside').click();
    await expect(popup).toBeHidden();
    await expect(page.locator('#menus-outside')).toBeFocused();
  });
  test('context long press activates and pointer movement cancels activation', async ({ page }) => {
    const target = page.getByText('Context target', { exact: true });
    await target.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
    await expect(page.getByRole('menu', { name: 'Context actions', exact: true })).toBeVisible();
    expect(
      await target.evaluate((element) =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
      ),
    ).toBe(false);
    await page.keyboard.press('Escape');
    await target.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100 });
    await target.dispatchEvent('pointermove', { pointerType: 'touch', clientX: 130, clientY: 100 });
    await page.waitForTimeout(550);
    await expect(page.getByRole('menu', { name: 'Context actions', exact: true })).toBeHidden();
  });
  test('menubar roves, skips disabled triggers, switches through nested menus and exits on Tab', async ({
    page,
  }) => {
    const bar = page.getByRole('menubar', { name: 'Application' });
    const file = bar.getByRole('menuitem', { name: 'File', exact: true });
    const edit = bar.getByRole('menuitem', { name: 'Edit', exact: true });
    await file.focus();
    await page.keyboard.press('ArrowRight');
    await expect(edit).toBeFocused();
    await page.keyboard.press('Home');
    await expect(file).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(file).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: 'New file' })).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: 'Recent document' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: 'Undo edit' })).toBeFocused();
    await expect(file).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
    await edit.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu', { name: 'Edit actions' })).toBeHidden();
    await expect(page.locator('#after-menubar')).toBeFocused();
    await file.click();
    await edit.hover();
    await expect(page.getByRole('menu', { name: 'Edit actions' })).toBeVisible();
    await page.locator('#menus-outside').click();
    await expect(edit).toHaveAttribute('aria-expanded', 'false');
  });
  test('navigation hover delay, viewport sizes, trigger/content keyboard routing, links and dismissal', async ({
    page,
  }) => {
    const learn = page.getByRole('button', { name: 'Learn' });
    const tools = page.getByRole('button', { name: 'Tools' });
    const viewport = page.getByTestId('navigation-viewport');
    await learn.hover();
    await expect(learn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('link', { name: 'Read guide' })).toBeVisible();
    await expect(viewport).toHaveCSS('--navigation-menu-viewport-width', '240px');
    await expect(viewport).toHaveCSS('--navigation-menu-viewport-height', '120px');
    await tools.hover();
    await expect(page.getByRole('link', { name: 'Browse tools' })).toBeVisible();
    await expect(viewport).toHaveCSS('--navigation-menu-viewport-width', '360px');
    await expect(viewport).toHaveCSS('--navigation-menu-viewport-height', '180px');
    await tools.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(learn).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('link', { name: 'Read guide' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(learn).toBeFocused();
    await expect(learn).toHaveAttribute('aria-expanded', 'false');
    await learn.press('ArrowUp');
    await expect(page.getByRole('link', { name: 'Read tutorial' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tools).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(tools).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('link', { name: 'Home link' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await learn.click();
    await page.locator('#menus-outside').click();
    await expect(learn).toHaveAttribute('aria-expanded', 'false');
  });
});
