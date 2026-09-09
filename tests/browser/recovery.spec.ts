import { expect, test } from '@playwright/test';
import type { mountIdentityFixture, mountRecoveryFixture } from '../fixtures/recoveryFixture';
declare global {
  interface Window {
    identityTest: ReturnType<typeof mountIdentityFixture>;
    recoveryTest: ReturnType<typeof mountRecoveryFixture>;
    closingTest: Promise<void>;
  }
}

for (const kind of ['component', 'local', 'program', 'tasks'] as const) {
  test(`${kind} identity preserves same-entity state and replaces the whole subtree on change`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(async (kind) => {
      const path = '/tests/fixtures/recoveryFixture.tsx';
      const { mountIdentityFixture } = (await import(
        path
      )) as typeof import('../fixtures/recoveryFixture');
      window.identityTest = mountIdentityFixture(document.body, kind);
    }, kind);
    await page.locator('[data-increment]').click();
    await page.locator('[data-draft]').fill('unsaved');
    const old = await page.locator('[data-editor]').elementHandle();
    await page.evaluate(() => window.identityTest.update({ label: 'updated' }));
    await expect(page.locator('[data-increment]')).toHaveText('a:updated:1');
    await expect(page.locator('[data-draft]')).toHaveValue('unsaved');
    expect(await old!.evaluate((node) => node.isConnected)).toBe(true);
    await page.evaluate(() => window.identityTest.update({ id: 'b', label: 'next' }));
    await expect(page.locator('[data-increment]')).toHaveText('b:next:0');
    await expect(page.locator('[data-draft]')).toHaveValue('next');
    await expect(page.locator('[data-identity-portal]')).toHaveText('b');
    expect(await old!.evaluate((node) => node.isConnected)).toBe(false);
    await page.evaluate(() => window.identityTest.oldSend());
    await expect(page.locator('[data-increment]')).toHaveText('b:next:0');
    const events = await page.evaluate(() => window.identityTest.events());
    expect(events).toContain('dispose:a');
    expect(events).toContain('mount:b');
    expect(events).not.toContain('receive:a:b');
    if (kind === 'component' || kind === 'tasks') expect(events).toContain('cancel:a');
    await page.evaluate(() => window.identityTest.close());
    await expect(page.locator('[data-identity-portal]')).toHaveCount(0);
    expect(
      (await page.evaluate(() => window.identityTest.events())).filter(
        (event) => event === 'dispose:b',
      ),
    ).toHaveLength(1);
  });
}

for (const initial of [false, true]) {
  test(`boundary recovers from ${initial ? 'initial build' : 'update'} failure and resets explicitly`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(async (initial) => {
      const path = '/tests/fixtures/recoveryFixture.tsx';
      const { mountRecoveryFixture } = (await import(
        path
      )) as typeof import('../fixtures/recoveryFixture');
      window.recoveryTest = mountRecoveryFixture(document.body, initial, true);
    }, initial);
    if (!initial) {
      await expect(page.locator('[data-content]')).toBeVisible();
      await page.evaluate(() => window.recoveryTest.update({ broken: true, label: 'broken' }));
    }
    await expect(page.locator('[data-fallback]')).toBeVisible();
    await expect(page.locator('[data-content]')).toHaveCount(0);
    await expect(page.locator('[data-recovery-portal]')).toHaveCount(0);
    await expect(page.locator('[data-outer]')).toHaveCount(0);
    await page.evaluate(() => window.recoveryTest.update({ broken: false, label: 'fresh' }));
    await expect(page.locator('[data-fallback]')).toHaveText('Failed:fresh');
    await expect(page.locator('[data-sibling]')).toHaveText('fresh');
    await page.locator('[data-fallback]').click();
    await expect(page.locator('[data-content]')).toBeVisible();
    await expect(page.locator('[data-value]')).toHaveText('fresh');
    await expect(page.locator('[data-recovery-portal]')).toHaveText('fresh');
    const state = await page.evaluate(() => window.recoveryTest.state());
    expect(state.errors).toHaveLength(1);
    expect(state.outerErrors).toEqual([]);
    expect(state.unhandled).toEqual([]);
    expect(state.events).toContain('fallback-dispose');
    await page.evaluate(() => {
      window.closingTest = window.recoveryTest.close();
    });
    await expect(page.locator('[data-content]')).toHaveCount(0);
    expect((await page.evaluate(() => window.recoveryTest.state())).closed).toBe(false);
    await page.evaluate(async () => {
      window.recoveryTest.release();
      await window.closingTest;
    });
    const completed = await page.evaluate(() => window.recoveryTest.state());
    expect(completed.closed).toBe(true);
    expect(completed.events.filter((event) => event === 'closed')).toHaveLength(initial ? 1 : 2);
  });
}

test('fallback failure reaches the enclosing boundary and can recover', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/recoveryFixture.tsx';
    const { mountRecoveryFixture } = (await import(
      path
    )) as typeof import('../fixtures/recoveryFixture');
    window.recoveryTest = mountRecoveryFixture(document.body, false, true);
  });
  await page.evaluate(() => window.recoveryTest.update({ broken: true, fallbackBroken: true }));
  await expect(page.locator('[data-outer]')).toHaveText('Outer:first');
  await expect(page.locator('[data-fallback]')).toHaveCount(0);
  expect((await page.evaluate(() => window.recoveryTest.state())).outerErrors).toHaveLength(1);
  await page.evaluate(() =>
    window.recoveryTest.update({ broken: false, fallbackBroken: false, reset: 1 }),
  );
  await expect(page.locator('[data-content]')).toBeVisible();
  await expect(page.locator('[data-outer]')).toHaveCount(0);
  await page.evaluate(async () => {
    window.recoveryTest.release();
    await window.recoveryTest.close();
  });
});

test('unmount before queued fallback prevents remounting a disposed boundary', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(async () => {
    const path = '/tests/fixtures/recoveryFixture.tsx';
    const { mountRecoveryFixture } = (await import(
      path
    )) as typeof import('../fixtures/recoveryFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = mountRecoveryFixture(host, true);
    const closing = fixture.close();
    fixture.release();
    await closing;
    await Promise.resolve();
    return { ...fixture.state(), children: host.childNodes.length };
  });
  expect(state.children).toBe(0);
  expect(state.events).not.toContain('fallback-mount');
});

for (const kind of ['host', 'event', 'command'] as const) {
  test(`boundary disposes a component after an owned ${kind} defect`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (kind) => {
      const path = '/tests/fixtures/recoveryFixture.tsx';
      const { mountDefectFixture } = (await import(
        path
      )) as typeof import('../fixtures/recoveryFixture');
      const host = document.createElement('div');
      document.body.append(host);
      const fixture = mountDefectFixture(host, kind);
      await Promise.resolve();
      if (kind !== 'host') host.querySelector<HTMLButtonElement>('[data-defect]')!.click();
      await Promise.resolve();
      const failed = Boolean(host.querySelector('[data-defect-fallback]'));
      const detached = !host.querySelector('[data-defect]');
      await fixture.close();
      return { failed, detached, ...fixture.state() };
    }, kind);
    expect(result.failed).toBe(true);
    expect(result.detached).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.events).toEqual(kind === 'host' ? [] : ['mount', 'dispose']);
  });
}

test('late cleanup failure from a replaced subtree cannot break the recovered instance', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/recoveryFixture.tsx';
    const { staleBoundaryCleanupFixture } = (await import(
      path
    )) as typeof import('../fixtures/recoveryFixture');
    return staleBoundaryCleanupFixture();
  });
  expect(result.errors).toEqual(['Error: old cleanup']);
  expect(result.content).toBe('b');
  expect(result.fallback).toBe(false);
});

test('awaited unmount joins a pending lazy loader finalizer', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/recoveryFixture.tsx';
    const { lazyCloseFixture } = (await import(
      path
    )) as typeof import('../fixtures/recoveryFixture');
    return lazyCloseFixture();
  });
  expect(result).toEqual({ waiting: true, finalized: true });
});

test('slotted content reports failures to its placement boundary', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/recoveryFixture.tsx';
    const { slotBoundaryFixture } = (await import(
      path
    )) as typeof import('../fixtures/recoveryFixture');
    return slotBoundaryFixture();
  });
  expect(result).toEqual({
    errors: ['Error: slot failed'],
    unhandled: [],
    failed: true,
    detached: true,
  });
});
