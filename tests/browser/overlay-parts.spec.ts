import { expect, test } from '@playwright/test';
for (const family of ['dialog', 'alert', 'popover', 'sheet', 'drawer']) {
  test(`separate styled ${family} parts retain naming, focus and dismissal`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      const path = '/tests/fixtures/overlayPartsFixture.tsx';
      const fixture = (await import(path)) as typeof import('../fixtures/overlayPartsFixture');
      fixture.mountOverlayPartsFixture(document.body.appendChild(document.createElement('div')));
    });
    const trigger = page.getByRole('button', { name: `Split ${family}` });
    await trigger.click();
    const name = family[0]!.toUpperCase() + family.slice(1);
    const popup = page.getByRole(family === 'alert' ? 'alertdialog' : 'dialog', {
      name: `${name} title`,
      exact: true,
    });
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAccessibleDescription(`${name} description`);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    if (family === 'sheet') await expect(popup).toHaveAttribute('data-side', 'left');
    if (family === 'drawer') await expect(popup).toHaveAttribute('data-direction', 'bottom');
    if (family === 'alert') {
      await page.keyboard.press('Escape');
      await expect(popup).toBeVisible();
    }
    await popup.evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    });
    const exit = await popup.evaluate(async (element, family) => {
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent === `Done ${family}`)!
        .click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        ending: element.hasAttribute('data-ending-style'),
        shown:
          element instanceof HTMLDialogElement ? element.open : element.matches(':popover-open'),
        animation: getComputedStyle(element).animationName,
      };
    }, family);
    expect(exit.ending).toBe(true);
    expect(exit.shown).toBe(true);
    expect(exit.animation).toContain('exit');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
}
