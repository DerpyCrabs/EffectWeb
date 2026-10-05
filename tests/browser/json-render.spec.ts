import { expect, test } from '@playwright/test';

test('JSON element IDs preserve native focus, selection and draft through reorder and removal', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/jsonRenderFixture.tsx';
    const { checkJsonIdentity } = (await import(
      fixturePath
    )) as typeof import('../fixtures/jsonRenderFixture');
    const host = document.createElement('div');
    document.body.append(host);
    try {
      return checkJsonIdentity(host);
    } finally {
      host.remove();
    }
  });
  expect(result).toEqual({
    sameNode: true,
    focused: true,
    selection: [1, 3],
    otherValue: '',
    afterRemoval: true,
    value: 'draft',
  });
});
