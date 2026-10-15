import { expect, test } from '@playwright/test';

test('callback boundaries skip unchanged chrome without retaining stale values or commands', async ({
  page,
}, testInfo) => {
  await page.goto('/tests/performance/');
  await page.waitForFunction(() => Boolean(window.performanceFixture));
  for (const pattern of ['named', 'inline', 'snapshot', 'broad', 'selected'] as const) {
    const result = await page.evaluate(
      (pattern) => window.performanceFixture.callbackWork(pattern, 48, 100),
      pattern,
    );
    expect(result.focus.rows).toBe(pattern === 'selected' ? 0 : 4800);
    expect(result.focus.projections).toBe(pattern === 'selected' ? 4800 : 0);
    // Opaque whole-model helpers deliberately remain conservative.
    expect(result.focus.children).toBe(pattern === 'broad' ? 4800 : 199);
    expect(result.activeRows).toEqual([3]);
    expect(result.positionUpdated).toBe(true);
    expect(result.picked).toEqual(['new:0']);
    expect(result.retained).toBe(true);
    expect(result.disposed).toBe(true);
    expect(result.subscriptionsDisposed).toBe(true);
    await testInfo.attach(`callbacks-${pattern}`, {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
  }
});

test('equivalent style snapshots skip reconciliation; changed fields alone write CSS', async ({
  page,
}) => {
  await page.goto('/tests/performance/');
  await page.waitForFunction(() => Boolean(window.performanceFixture));
  const result = await page.evaluate(() => window.performanceFixture.styleWork());
  expect(result.unchanged).toEqual({ writes: 0, reads: 0 });
  expect(result.changed).toEqual(['left']);
  expect(result.repaired).toBe('20px');
  expect(result.reordered).toBe('10px');
  expect(result.transitioned).toEqual(['blue', '', '2', '2']);
  expect(result.cleared).toBeNull();
});

for (const count of [1, 48, 192]) {
  test(`${count} windows avoid unrelated renders and retain unchanged rows`, async ({
    page,
  }, testInfo) => {
    await page.goto('/tests/performance/');
    await page.waitForFunction(() => Boolean(window.performanceFixture));
    const result = await page.evaluate(
      (count) => window.performanceFixture.windowWork(count, 100),
      count,
    );
    expect(result.unrelatedRenders).toBe(0);
    expect(result.changedRenders).toBe(100);
    expect(result.retained).toBe(true);
    expect(result.left).toBe('100px');
    await testInfo.attach('timing', {
      body: JSON.stringify({ count, updates: 100, ...result }),
      contentType: 'application/json',
    });
  });
}

test('style avoidance preserves declaration order, resets, priorities and class composition', async ({
  page,
}) => {
  await page.goto('/tests/performance/');
  await page.waitForFunction(() => Boolean(window.performanceFixture));
  const result = await page.evaluate(() => window.performanceFixture.styleSemantics());
  expect(result.failures).toEqual([]);
  expect(result.clone).toBe('color: blue;');
  expect(result.priority).toBe('');
  expect(result.shorthandPriority).toBe('');
  expect(result.unchangedAdditions).toBe(0);
  expect(result.classes).toBe('replacement selected');
});
