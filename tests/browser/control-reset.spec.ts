import { expect, test } from '@playwright/test';
test('native reset restores controlled properties after default action, including external forms', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const outside = document.createElement('form');
    outside.id = 'external-reset';
    document.body.append(outside);
    const path = '/tests/fixtures/controlResetFixture.tsx';
    const { mountControlResetFixture } = (await import(
      path
    )) as typeof import('../fixtures/controlResetFixture');
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = mountControlResetFixture(host);
    outside.addEventListener('reset', () => fixture.setText('new model'));
  });
  await page.getByRole('button', { name: 'Native reset' }).click();
  await expect(page.getByRole('textbox', { name: 'Reset text', exact: true })).toHaveValue(
    'accepted',
  );
  await expect(page.getByRole('slider', { name: 'Reset range' })).toHaveValue('20');
  await expect(page.getByRole('checkbox', { name: 'Reset check' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Reset textarea' })).toHaveValue('accepted');
  await expect(page.getByRole('combobox', { name: 'Reset select' })).toHaveValue('b');
  expect(
    await page
      .getByRole('listbox', { name: 'Reset tags' })
      .evaluate((select: HTMLSelectElement) => [...select.selectedOptions].map((o) => o.value)),
  ).toEqual(['a', 'c']);
  expect(
    await page
      .locator('reset-field')
      .evaluate((field) => (field as HTMLElement & { value: string }).value),
  ).toBe('accepted');
  await page.evaluate(() => (document.querySelector('#external-reset') as HTMLFormElement).reset());
  await expect(page.getByRole('textbox', { name: 'External text' })).toHaveValue('new model');
  await page.getByRole('textbox', { name: 'Reset text', exact: true }).fill('draft');
  await page.evaluate(() => {
    const form = document.querySelector('#owned-reset') as HTMLFormElement;
    form.addEventListener('reset', (event) => event.preventDefault(), { once: true });
    form.reset();
  });
  await page.waitForTimeout(30);
  await expect(page.getByRole('textbox', { name: 'Reset text', exact: true })).toHaveValue('draft');
});

test('a cancelled second reset preserves restoration from the successful first reset', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/controlResetFixture.tsx';
    const { mountControlResetFixture } = (await import(
      path
    )) as typeof import('../fixtures/controlResetFixture');
    const host = document.createElement('div');
    document.body.append(host);
    mountControlResetFixture(host);
    const form = host.querySelector('form')!;
    form.reset();
    form.addEventListener('reset', (event) => event.preventDefault(), { once: true });
    form.dispatchEvent(new Event('reset', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('textbox', { name: 'Reset text', exact: true })).toHaveValue(
    'accepted',
  );
  await expect(page.getByRole('checkbox', { name: 'Reset check' })).toBeChecked();
});

test('native reset restores controls mounted inside a shadow root', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/controlResetFixture.tsx';
    const { mountControlResetFixture } = (await import(
      path
    )) as typeof import('../fixtures/controlResetFixture');
    const container = document.createElement('div');
    document.body.append(container);
    const root = container.attachShadow({ mode: 'open' });
    const host = document.createElement('div');
    root.append(host);
    mountControlResetFixture(host);
  });
  await page.getByRole('button', { name: 'Native reset' }).click();
  await expect(page.getByRole('textbox', { name: 'Reset text', exact: true })).toHaveValue(
    'accepted',
  );
  await expect(page.getByRole('checkbox', { name: 'Reset check' })).toBeChecked();
});
