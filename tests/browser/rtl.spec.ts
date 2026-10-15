import { expect, test } from '@playwright/test';
for (const inherited of ['ancestor', 'document', 'override']) {
  test(`RTL routes controls and placement from ${inherited}`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (inherited) => {
      document.documentElement.dir = inherited === 'ancestor' ? 'ltr' : 'rtl';
      const host = document.body.appendChild(document.createElement('div'));
      if (inherited === 'ancestor') host.dir = 'rtl';
      if (inherited === 'override') host.dir = 'ltr';
      const path = '/tests/fixtures/rtlFixture.tsx';
      const fixture = (await import(path)) as typeof import('../fixtures/rtlFixture');
      fixture.mountRtlFixture(host);
    }, inherited);
    const rtl = inherited !== 'override';
    for (const [role, selector] of [
      ['tab', '[role=tablist]'],
      ['radio', '[role=radiogroup]'],
      ['button', '[role=group]'],
    ] as const) {
      const root = page.locator(selector);
      await root.getByRole(role, { name: 'a', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(root.getByRole(role, { name: rtl ? 'c' : 'b', exact: true })).toBeFocused();
      await page.keyboard.press('Home');
      await expect(root.getByRole(role, { name: 'a', exact: true })).toBeFocused();
    }
    const slider = page.getByRole('slider');
    await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuenow', rtl ? '49' : '51');
    await page.getByRole('button', { name: 'Anchor' }).click();
    const popup = page.getByText('Popup', { exact: true });
    await expect(popup).toHaveAttribute('data-side', rtl ? 'right' : 'left');
    const rect = await popup.boundingBox();
    expect(rtl ? rect!.x >= 600 : rect!.x + rect!.width <= 500).toBe(true);
  });
}
test('RTL menu submenus and menubar/navigation routing', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/menuFamiliesFixture.tsx';
    const fixture = (await import(path)) as typeof import('../fixtures/menuFamiliesFixture');
    const host = document.body.appendChild(document.createElement('div'));
    host.dir = 'rtl';
    fixture.mountMenuFamiliesFixture(host);
  });
  await page.getByRole('menuitem', { name: 'File', exact: true }).press('ArrowDown');
  await page.getByRole('menuitem', { name: 'Recent files' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menuitem', { name: 'Recent document' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Recent files' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: 'File', exact: true }).press('ArrowLeft');
  await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Learn' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: 'Tools' })).toBeFocused();
});
