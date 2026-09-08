import { expect, test } from '@playwright/test';
import type { createLazyViewFixture } from '../fixtures/lazyViewFixture';

declare global {
  interface Window {
    lazyViewFixture: ReturnType<typeof createLazyViewFixture>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/lazyViewFixture.tsx';
    const { createLazyViewFixture } = (await import(
      path
    )) as typeof import('../fixtures/lazyViewFixture');
    window.lazyViewFixture = createLazyViewFixture(document.body);
  });
});

test('loads on mount, uses fresh inputs and retains the loaded DOM and dispatcher', async ({
  page,
}) => {
  expect(await page.evaluate(() => window.lazyViewFixture.state().starts)).toBe(0);
  await page.evaluate(() => window.lazyViewFixture.mount('first', 'initial'));
  await expect(page.locator('[data-lazy-pending]')).toHaveText('Loading initial');
  await page.evaluate(() => window.lazyViewFixture.update('first', 'during load'));
  await expect(page.locator('[data-lazy-pending]')).toHaveText('Loading during load');
  await page.locator('[data-lazy-pending]').click();
  expect(await page.evaluate(() => window.lazyViewFixture.state().starts)).toBe(1);
  await page.evaluate(() => window.lazyViewFixture.resolve(0));
  await expect(page.locator('[data-lazy-loaded]')).toHaveText('during load');
  await expect(page.locator('[data-lazy-pending]')).toHaveCount(0);
  await page.locator('[data-lazy-draft]').fill('local draft');
  const retained = await page.evaluate(() => {
    const input = document.querySelector('[data-lazy-draft]');
    const button = document.querySelector('[data-lazy-loaded]');
    window.lazyViewFixture.update('first', 'after load');
    return (
      input === document.querySelector('[data-lazy-draft]') &&
      button === document.querySelector('[data-lazy-loaded]')
    );
  });
  expect(retained).toBe(true);
  await expect(page.locator('[data-lazy-draft]')).toHaveValue('local draft');
  await expect(page.locator('[data-lazy-loaded]')).toHaveText('after load');
  await page.locator('[data-lazy-loaded]').click();
  expect(await page.evaluate(() => window.lazyViewFixture.state())).toMatchObject({
    starts: 1,
    pendingMounts: 1,
    pendingDisposals: 1,
    loadedMounts: 1,
    loadedDisposals: 0,
    events: [
      { id: 'first', title: 'during load' },
      { id: 'first', title: 'after load' },
    ],
    errors: [],
  });
  await page.evaluate(() => window.lazyViewFixture.dispose());
  expect(await page.evaluate(() => window.lazyViewFixture.state().loadedDisposals)).toBe(1);
  await expect(page.locator('[data-lazy-loaded]')).toHaveCount(0);
});

test('caches a successful definition for future mounts while keeping placements independent', async ({
  page,
}) => {
  await page.evaluate(() => window.lazyViewFixture.mount('first', 'first'));
  await page.evaluate(() => window.lazyViewFixture.resolve(0));
  await expect(page.locator('[data-lazy-loaded]')).toHaveText('first');
  await page.evaluate(() => window.lazyViewFixture.unmount('first'));
  await page.evaluate(() => {
    window.lazyViewFixture.mount('second', 'second');
    window.lazyViewFixture.mount('third', 'third');
  });
  await expect(page.locator('[data-lazy-loaded]')).toHaveText(['second', 'third']);
  await expect(page.locator('[data-lazy-pending]')).toHaveCount(0);
  await page.locator('[data-lazy-placement="third"] [data-lazy-loaded]').click();
  expect(await page.evaluate(() => window.lazyViewFixture.state())).toMatchObject({
    starts: 1,
    pendingMounts: 1,
    loadedMounts: 3,
    loadedDisposals: 1,
    events: [{ id: 'third', title: 'third' }],
    errors: [],
  });
  await page.evaluate(() => window.lazyViewFixture.dispose());
  expect(await page.evaluate(() => window.lazyViewFixture.state().loadedDisposals)).toBe(3);
});

test('interrupts only the removed placement and ignores its late successful import', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.lazyViewFixture.mount('removed', 'removed');
    window.lazyViewFixture.mount('kept', 'kept');
  });
  await expect(page.locator('[data-lazy-pending]')).toHaveText(['Loading removed', 'Loading kept']);
  await page.evaluate(() => window.lazyViewFixture.unmount('removed'));
  await expect.poll(() => page.evaluate(() => window.lazyViewFixture.state().aborted)).toBe(1);
  expect(await page.evaluate(() => window.lazyViewFixture.state().starts)).toBe(2);
  await page.evaluate(() => window.lazyViewFixture.resolve(0));
  await expect(page.locator('[data-lazy-loaded]')).toHaveCount(0);
  await expect(page.locator('[data-lazy-pending]')).toHaveText('Loading kept');
  await page.evaluate(() => window.lazyViewFixture.resolve(1));
  await expect(page.locator('[data-lazy-loaded]')).toHaveText('kept');
  expect(await page.evaluate(() => window.lazyViewFixture.state())).toMatchObject({
    loadedMounts: 1,
    pendingDisposals: 2,
    errors: [],
  });
  await page.evaluate(() => window.lazyViewFixture.dispose());
});

test('disposal suppresses a late loader rejection and releases pending content', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(() => window.lazyViewFixture.mount('removed', 'removed'));
  await expect(page.locator('[data-lazy-pending]')).toHaveText('Loading removed');
  await page.evaluate(() => window.lazyViewFixture.dispose());
  await expect.poll(() => page.evaluate(() => window.lazyViewFixture.state().aborted)).toBe(1);
  await page.evaluate(() => window.lazyViewFixture.reject(0, 'late rejection'));
  await expect(
    page.locator('[data-lazy-pending],[data-lazy-loaded],[data-lazy-failure]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.lazyViewFixture.state())).toMatchObject({
    pendingDisposals: 1,
    loadedMounts: 0,
    failureMounts: 0,
    errors: [],
  });
  expect(errors).toEqual([]);
});

test('stops replacement if pending cleanup unmounts the enclosing placement', async ({ page }) => {
  await page.evaluate(() => window.lazyViewFixture.mount('removed', 'removed'));
  await expect(page.locator('[data-lazy-pending]')).toHaveText('Loading removed');
  await page.evaluate(() => window.lazyViewFixture.unmountOnPendingDisposal('removed'));
  await page.evaluate(() => window.lazyViewFixture.resolve(0));
  await expect(page.locator('[data-lazy-pending],[data-lazy-loaded]')).toHaveCount(0);
  expect(await page.evaluate(() => window.lazyViewFixture.state())).toMatchObject({
    pendingDisposals: 1,
    loadedMounts: 0,
    errors: [],
  });
});

test('owns failure content, updates its inputs and retries a failed definition on remount', async ({
  page,
}) => {
  await page.evaluate(() => window.lazyViewFixture.mount('first', 'initial'));
  await page.evaluate(() => window.lazyViewFixture.reject(0, 'loader failed'));
  await expect(page.locator('[data-lazy-failure]')).toContainText('Failed initial');
  await expect(page.locator('[data-lazy-failure]')).toContainText('loader failed');
  await expect(page.locator('[data-lazy-pending]')).toHaveCount(0);
  await page.evaluate(() => window.lazyViewFixture.update('first', 'updated failure'));
  await expect(page.locator('[data-lazy-failure]')).toContainText('Failed updated failure');
  expect(await page.evaluate(() => window.lazyViewFixture.state())).toMatchObject({
    starts: 1,
    pendingDisposals: 1,
    failureMounts: 1,
    errors: [],
  });
  await page.evaluate(() => {
    window.lazyViewFixture.unmount('first');
    window.lazyViewFixture.mount('retry', 'retried');
  });
  await expect(page.locator('[data-lazy-pending]')).toHaveText('Loading retried');
  expect(await page.evaluate(() => window.lazyViewFixture.state().failureDisposals)).toBe(1);
  expect(await page.evaluate(() => window.lazyViewFixture.state().starts)).toBe(2);
  await page.evaluate(() => window.lazyViewFixture.resolve(1));
  await expect(page.locator('[data-lazy-loaded]')).toHaveText('retried');
  await page.evaluate(() => window.lazyViewFixture.dispose());
});

test('reports unhandled loader failures through the mount error callback', async ({ page }) => {
  await page.evaluate(async () => {
    window.lazyViewFixture.dispose();
    const path = '/tests/fixtures/lazyViewFixture.tsx';
    const { createLazyViewFixture } = (await import(
      path
    )) as typeof import('../fixtures/lazyViewFixture');
    window.lazyViewFixture = createLazyViewFixture(document.body, false);
    window.lazyViewFixture.mount('failed', 'failed');
    await window.lazyViewFixture.reject(0, 'unhandled loader failure');
  });
  await expect
    .poll(() => page.evaluate(() => window.lazyViewFixture.state().errors.length))
    .toBe(1);
  expect(await page.evaluate(() => window.lazyViewFixture.state().errors[0])).toContain(
    'unhandled loader failure',
  );
  await expect(page.locator('[data-lazy-loaded],[data-lazy-failure]')).toHaveCount(0);
  await page.evaluate(() => window.lazyViewFixture.dispose());
});
