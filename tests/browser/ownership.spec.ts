import { expect, test } from '@playwright/test';

test('compiled hosts and events preserve their owners through reentrant and attribute updates', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/ownershipFixture.tsx';
    const { ownershipContracts } = (await import(
      path
    )) as typeof import('../fixtures/ownershipFixture');
    return ownershipContracts();
  });
  expect(result.blurDraft).toBe('unfinished draft');
  expect(result.publishedDraft).toBe('published edit');
  expect(result.initialPublication).toEqual({ model: { count: 1 }, dom: '11' });
  expect(result.optionalEvents).toEqual({ direct: [], spread: [] });
  expect(result.lifecycle).toEqual(
    Array.from({ length: 8 }, () => ({
      started: ['started'],
      afterUpdate: ['started'],
      errors: [],
    })),
  );
  expect(result.modelSpreadEvents).toEqual(['started']);
  expect(result.optionalTransitions).toEqual(
    Array.from({ length: 4 }, () => ({
      events: ['started', 'interrupted', 'replacement', 'replacement interrupted'],
      errors: [],
    })),
  );
  expect(result.selfRemoval).toEqual({ model: { show: false }, dom: '', cleanups: ['disposed'] });
});
