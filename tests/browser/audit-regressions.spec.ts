import { expect, test } from '@playwright/test';

test('preserves blur drafts through native input and composition, then accepts or rejects on blur', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/auditFixture.tsx';
    const { mountControls } = await import(path);
    mountControls(document.body);
  });
  const accepted = page.getByLabel('Blur accepted');
  await accepted.fill('approved ');
  // Allow native restoration tasks to run before committing by moving focus.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
  await expect(accepted).toHaveValue('approved ');
  await accepted.blur();
  await expect(accepted).toHaveValue('approved');
  const rejected = page.getByLabel('Blur rejected');
  await rejected.fill('draft');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
  await expect(rejected).toHaveValue('draft');
  await rejected.evaluate((input: HTMLTextAreaElement) => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '途中';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
  await expect(rejected).toHaveValue('途中');
  await rejected.blur();
  await expect(rejected).toHaveValue('approved');
});

test('restores rejected delegated input, select changes, and checkbox clicks', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/auditFixture.tsx';
    const { mountControls } = await import(path);
    mountControls(document.body);
  });
  await page.getByLabel('Delegated rejected').fill('edit');
  await expect(page.getByLabel('Delegated rejected')).toHaveValue('x');
  await page.getByLabel('Select rejected').selectOption('y');
  await expect(page.getByLabel('Select rejected')).toHaveValue('x');
  await page.getByLabel('Click rejected').click();
  await expect(page.getByLabel('Click rejected')).not.toBeChecked();
});

test('native input handlers receive the edit before controlled restoration', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/auditFixture.tsx';
    const { mountControls } = await import(path);
    mountControls(document.body);
  });
  await page.getByLabel('Normalized').fill('updated');
  await expect(page.getByLabel('Rejected', { exact: true })).toHaveValue('updated');
  await page.getByLabel('Normalized').fill('updated ');
  await expect(page.getByLabel('Normalized')).toHaveValue('updated');
  await page.getByLabel('Rejected', { exact: true }).fill('rejected');
  await expect(page.getByLabel('Rejected', { exact: true })).toHaveValue('updated');
});

test('restores normalized and rejected native edits even when the model does not change', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/auditFixture.tsx';
    const { mountControls } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const app = mountControls(host);
    const normalized = host.querySelector<HTMLInputElement>('[aria-label="Normalized"]')!;
    const rejected = host.querySelector<HTMLInputElement>('[aria-label="Rejected"]')!;
    const checked = host.querySelector<HTMLInputElement>('[aria-label="Checked"]')!;
    const initial = app.model();
    normalized.value = 'x ';
    normalized.dispatchEvent(new InputEvent('input', { bubbles: true }));
    rejected.value = 'rejected edit';
    rejected.dispatchEvent(new InputEvent('input', { bubbles: true }));
    checked.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = {
      normalized: normalized.value,
      rejected: rejected.value,
      checked: checked.checked,
      sameModel: app.model() === initial,
    };
    app.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({ normalized: 'x', rejected: 'x', checked: false, sameModel: true });
});

test('clears a dirty checked property when its bound value becomes undefined', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/auditFixture.tsx';
    const { mountControls } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const app = mountControls(host);
    const input = host.querySelector<HTMLInputElement>('[aria-label="Checked"]')!;
    input.click();
    app.set({ checked: true });
    app.set({ checked: undefined });
    const result = { checked: input.checked, attribute: input.hasAttribute('checked') };
    app.dispose();
    host.remove();
    return result;
  });
  expect(result).toEqual({ checked: false, attribute: false });
});

test('leaves composition edits alone until composition ends and drops pending work on disposal', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/auditFixture.tsx';
    const { mountControls } = await import(path);
    const host = document.createElement('div');
    document.body.append(host);
    const app = mountControls(host);
    const input = host.querySelector<HTMLInputElement>('[aria-label="Rejected"]')!;
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '途中';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const composing = { value: input.value, selection: input.selectionStart };
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settled = input.value;
    input.value = 'detached';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    app.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disposed = input.value;
    host.remove();
    return { composing, settled, disposed };
  });
  expect(result).toEqual({
    composing: { value: '途中', selection: 1 },
    settled: 'x',
    disposed: 'detached',
  });
});
