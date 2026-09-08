import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/examples/profile-form/app.tsx';
    const { mountProfileForm } = (await import(
      path
    )) as typeof import('../../examples/profile-form/app');
    mountProfileForm(document.body);
  });
});

test('accessible fields retain drafts, reveal errors on blur, and reset touched and dirty state', async ({
  page,
}) => {
  const username = page.getByRole('textbox', { name: 'Username', exact: true });
  const hours = page.getByRole('textbox', { name: 'Weekly hours', exact: true });
  await page.locator('label[for="profile-hours"]').click();
  await expect(hours).toBeFocused();
  await expect(hours).toHaveValue('05');
  await expect(hours).toHaveAccessibleDescription(
    'A whole number from 1 to 40. Your draft keeps its formatting.',
  );
  await hours.fill('-');
  await expect(hours).toHaveValue('-');
  await expect(hours).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('[data-dirty]')).toHaveText('Unsaved changes');
  await username.focus();
  await expect(hours).toHaveAttribute('aria-invalid', 'true');
  await expect(hours).toHaveAccessibleDescription(
    'A whole number from 1 to 40. Your draft keeps its formatting. Enter a whole number from 1 to 40.',
  );
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(hours).toHaveValue('05');
  await expect(hours).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('[data-dirty]')).toHaveText('No changes');
  await expect(page.locator('#profile-username-error')).toBeEmpty();
  await expect(page.locator('#profile-hours-error')).toBeEmpty();
});

test('submit validates untouched fields and saves parsed values after async validation', async ({
  page,
}) => {
  const username = page.getByRole('textbox', { name: 'Username', exact: true });
  const hours = page.getByRole('textbox', { name: 'Weekly hours', exact: true });
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(username).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('status', { name: 'Saved profile' })).toBeEmpty();
  await username.fill('reader');
  await hours.fill('007');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status', { name: 'Saved profile' })).toHaveText(
    'Saved reader: 7 hours per week.',
  );
  await expect(hours).toHaveValue('007');
});

test('editing and reset cancel pending availability checks without showing stale errors', async ({
  page,
}) => {
  const username = page.getByRole('textbox', { name: 'Username', exact: true });
  const hours = page.getByRole('textbox', { name: 'Weekly hours', exact: true });
  await username.fill('admin');
  await hours.focus();
  await expect(username).toHaveAttribute('aria-busy', 'true');
  await username.fill('reader');
  await expect(username).toHaveAttribute('aria-busy', 'false');
  await hours.focus();
  await expect(username).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#profile-username-error')).toBeEmpty();
  await username.fill('admin');
  await hours.focus();
  await expect(page.locator('#profile-username-error')).toHaveText(
    'This username is already taken.',
  );
  await username.fill('admin2');
  await hours.focus();
  await expect(username).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(username).toHaveValue('');
  await expect(username).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#profile-username-error')).toBeEmpty();
});

test('unmount interrupts form validation and removes its DOM', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const appPath = '/examples/profile-form/app.tsx';
    const effectPath = '/node_modules/effect/dist/Effect.js';
    const [{ mountProfileForm }, Effect] = await Promise.all([
      import(appPath) as Promise<typeof import('../../examples/profile-form/app')>,
      import(effectPath) as Promise<typeof import('effect/Effect')>,
    ]);
    let interrupted = false;
    const host = document.createElement('div');
    document.body.append(host);
    const form = mountProfileForm(host, {
      available: () =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      save: Effect.succeed,
    });
    form.send({ type: 'Username', message: { type: 'Change', draft: 'reader' } });
    form.send({ type: 'Username', message: { type: 'Blur' } });
    const pending = form.model().username.validation;
    form.dispose();
    await Promise.resolve();
    const children = host.childNodes.length;
    host.remove();
    return { pending, interrupted, children };
  });
  expect(result).toEqual({ pending: 'pending', interrupted: true, children: 0 });
});
