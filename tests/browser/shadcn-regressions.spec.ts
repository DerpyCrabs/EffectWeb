import { expect, test, type Page } from '@playwright/test';
const control = (page: Page, family: string, controlled: boolean) =>
  page.evaluate(
    async ({ family, controlled }) => {
      const path = '/tests/fixtures/shadcnRegressionsFixture.tsx';
      const fixture = (await import(path)) as typeof import('../fixtures/shadcnRegressionsFixture');
      fixture.setControlled(family, controlled);
    },
    { family, controlled },
  );
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/shadcnRegressionsFixture.tsx';
    const { mountShadcnRegressions } = (await import(
      path
    )) as typeof import('../fixtures/shadcnRegressionsFixture');
    const host = document.createElement('main');
    document.body.append(host);
    mountShadcnRegressions(host);
  });
  await expect(page.locator('#coll-trigger')).toBeVisible();
});
for (const colorScheme of ['light', 'dark'] as const)
  test(`dark utilities follow the root class with ${colorScheme} OS preference`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(page.locator('#dark-probe')).toHaveCSS('display', 'none');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect(page.locator('#dark-probe')).toHaveCSS('display', 'block');
  });
test('sheet occupies the full viewport height', async ({ page }) => {
  await page.locator('#open-sheet').click();
  const sheet = page.locator('dialog[data-slot=sheet]');
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => Math.round((await sheet.boundingBox())!.height))
    .toBe(await page.evaluate(() => innerHeight));
});
for (const family of ['coll', 'menu', 'hover', 'tabs'])
  test(`${family} switches between uncontrolled and controlled props in both directions`, async ({
    page,
  }) => {
    const trigger = page.locator(family === 'tabs' ? '#tabs [role=tab]' : `#${family}-trigger`);
    const activate = async () => {
      if (family === 'hover') {
        await page.mouse.move(0, 0);
        await trigger.hover();
        await page.waitForTimeout(180);
      } else if (family === 'tabs') await trigger.nth(1).click();
      else await trigger.click();
    };
    const target = page.locator(
      family === 'coll'
        ? '#coll-panel'
        : family === 'menu'
          ? '#menu [role=menu]'
          : family === 'hover'
            ? '#hover-content'
            : '#tabs [role=tabpanel]',
    );
    const assertOpen = async (open: boolean) => {
      if (family === 'tabs') await expect(target).toHaveText(open ? 'Panel B' : 'Panel A');
      else if (open) await expect(target).toBeVisible();
      else await expect(target).toBeHidden();
    };
    await activate();
    await assertOpen(true);
    await control(page, family, true);
    await assertOpen(false);
    await activate();
    await assertOpen(false);
    await control(page, family, false);
    await activate();
    await assertOpen(true);
    await control(page, family, true);
    await assertOpen(false);
  });
test('Escape cancels a pending hover open', async ({ page }) => {
  await page.locator('#hover-trigger').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(page.locator('#hover-content')).toBeHidden();
});
test('dropdown radio entries have grouped roles, indicators and independent selection', async ({
  page,
}) => {
  await page.locator('#radio-trigger').click();
  await expect(page.locator('#radios [data-slot=dropdown-menu-radio-group]')).toHaveCount(2);
  const a = page.getByRole('menuitemradio', { name: 'Radio A' });
  const b = page.getByRole('menuitemradio', { name: 'Radio B' });
  await expect(a).toHaveAttribute('aria-checked', 'true');
  await expect(a.locator('svg')).toBeVisible();
  await b.click();
  await page.locator('#radio-trigger').click();
  await expect(a).toHaveAttribute('aria-checked', 'false');
  await expect(b).toHaveAttribute('aria-checked', 'true');
  await expect(b.locator('svg')).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Radio C' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
test('drawer has its own slots, bottom handle and split parts', async ({ page }) => {
  await page.locator('#open-drawer').click();
  const drawer = page.locator('#drawer [data-slot=drawer-content]');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-direction', 'bottom');
  const box = (await drawer.boundingBox())!;
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  await expect(drawer.locator(':scope > [aria-hidden=true]')).toBeVisible();
  for (const slot of ['header', 'footer', 'title', 'description', 'close'])
    await expect(drawer.locator(`[data-slot=drawer-${slot}]`)).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Split drawer', exact: true }).click();
  await expect(page.locator('#parts [data-slot=drawer-content]')).toHaveAttribute(
    'data-direction',
    'left',
  );
  await expect(page.locator('#parts [data-slot=drawer-content] > [aria-hidden=true]')).toBeHidden();
  await expect(page.locator('#parts [data-slot=drawer-overlay]')).toHaveCount(1);
  await expect(page.locator('#parts [data-slot=dropdown-menu-sub-trigger]')).toHaveCount(1);
  await expect(page.locator('#parts [data-slot=dropdown-menu-sub-content]')).toHaveCount(1);
});
test('menubar indicators occupy the left gutter and use SVG icons', async ({ page }) => {
  for (const slot of ['checkbox', 'radio']) {
    const row = page.locator(`#indicators [data-slot=menubar-${slot}-item]`);
    const icon = row.locator('svg');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveClass(/lucide-check/);
    const [rowBox, iconBox] = [await row.boundingBox(), await icon.boundingBox()];
    expect(iconBox!.x - rowBox!.x).toBeLessThan(15);
  }
});
