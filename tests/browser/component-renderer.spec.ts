import { expect, test } from '@playwright/test';
import type { mountComponentFixture } from '../fixtures/componentFixture';
declare global {
  interface Window {
    componentFixture: ReturnType<typeof mountComponentFixture>;
  }
}

test('component models, compiled helpers and portal lifetimes retain state with fresh inputs', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/componentFixture.tsx';
    const fixture = (await import(path)) as typeof import('../fixtures/componentFixture');
    window.componentFixture = fixture.mountComponentFixture(document.body);
  });
  await page.locator('#child').click();
  await expect(page.locator('#child')).toHaveText('first:1:1');
  await page.locator('#local-first input').fill('draft');
  await expect(page.locator('#local-first button')).toHaveText('first:0:draft');
  await expect(page.locator('#local-second button')).toHaveText('first:0:');
  await expect(page.locator('#last')).toHaveText('first');
  await page.evaluate(() => window.componentFixture.title('second'));
  await expect(page.locator('#child')).toHaveText('second:1:1');
  await expect(page.locator('#helper')).toHaveText('second:suffix');
  await expect(page.locator('#constant')).toHaveText('second');
  await expect(page.locator('#local-first button')).toHaveText('second:0:draft');
  await page.locator('#local-first button').click();
  await expect(page.locator('#local-first button')).toHaveText('second:1:second');
  await page.locator('#child').click();
  await expect(page.locator('#last')).toHaveText('second');
  await page.locator('#portal').click();
  expect(await page.evaluate(() => window.componentFixture.counts())).toEqual({
    mounts: 1,
    disposals: 0,
    input: 'second',
  });
  await page.evaluate(() => window.componentFixture.hide());
  await expect(page.locator('#portal')).toHaveCount(0);
  expect(await page.evaluate(() => window.componentFixture.counts())).toEqual({
    mounts: 1,
    disposals: 1,
    input: 'second',
  });
  await page.evaluate(() => window.componentFixture.show());
  await expect(page.locator('#local-first button')).toHaveText('second:0:');
  await page.evaluate(() => window.componentFixture.dispose());
  expect(errors).toEqual([]);
});
