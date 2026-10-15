import { expect, test } from '@playwright/test';
const families = [
  'dialog',
  'alertDialog',
  'popover',
  'menu',
  'tooltip',
  'select',
  'combobox',
  'collapsible',
  'accordion',
  'context',
  'navigation',
  'toast',
  'styledDialog',
  'sheet',
];
for (const family of families) {
  for (const motion of [true, false]) {
    test(`${family}: ${motion ? 'defers CSS exit' : 'closes immediately without motion'}`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.evaluate(
        async ({ family, motion }) => {
          const path = '/tests/fixtures/presenceFixture.tsx';
          const fixture = (await import(path)) as typeof import('../fixtures/presenceFixture');
          fixture.mountPresenceFixture(
            document.body.appendChild(document.createElement('div')),
            family,
            motion,
          );
          fixture.setPresenceOpen(true);
        },
        { family, motion },
      );
      const panel = page.locator('.presence');
      await expect(panel).toBeVisible();
      await expect(panel).not.toHaveAttribute('data-starting-style');
      if (motion)
        await expect
          .poll(() => panel.evaluate((element) => getComputedStyle(element).opacity))
          .toBe('1');
      const ending = await page.evaluate(async () => {
        const path = '/tests/fixtures/presenceFixture.tsx';
        const fixture = (await import(path)) as typeof import('../fixtures/presenceFixture');
        fixture.setPresenceOpen(false);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const element = document.querySelector<HTMLElement>('.presence');
        return {
          ending: element?.hasAttribute('data-ending-style') ?? false,
          visible: !!element?.getClientRects().length,
        };
      });
      expect(ending).toEqual({ ending: motion, visible: motion });
      await expect(panel).toBeHidden();
    });
  }
}
test('reopening cancels pending native close', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/presenceFixture.tsx';
    const fixture = (await import(path)) as typeof import('../fixtures/presenceFixture');
    fixture.mountPresenceFixture(
      document.body.appendChild(document.createElement('div')),
      'dialog',
      true,
    );
    fixture.setPresenceOpen(true);
  });
  const panel = page.locator('.presence');
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/presenceFixture.tsx';
    const fixture = (await import(path)) as typeof import('../fixtures/presenceFixture');
    fixture.setPresenceOpen(false);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    fixture.setPresenceOpen(true);
  });
  await expect(panel).not.toHaveAttribute('data-ending-style');
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await expect(panel).toBeVisible();
});

test('opening publishes starting-style before the first painted frame', async ({ page }) => {
  await page.goto('/');
  const starting = await page.evaluate(async () => {
    const path = '/tests/fixtures/presenceFixture.tsx';
    const fixture = (await import(path)) as typeof import('../fixtures/presenceFixture');
    fixture.mountPresenceFixture(
      document.body.appendChild(document.createElement('div')),
      'dialog',
      true,
    );
    fixture.setPresenceOpen(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return document.querySelector('.presence')?.hasAttribute('data-starting-style');
  });
  expect(starting).toBe(true);
  await expect(page.locator('.presence')).not.toHaveAttribute('data-starting-style');
});
