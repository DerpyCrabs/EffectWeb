import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/tests/fixtures/baseUiRegressionsFixture.tsx';
    const { mountBaseUiRegressionsFixture } = (await import(
      path
    )) as typeof import('../fixtures/baseUiRegressionsFixture');
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    mountBaseUiRegressionsFixture(host);
  });
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
});

test('native controls reset initial values and indeterminate state after uncancelled reset', async ({
  page,
}) => {
  const checkbox = page.getByRole('checkbox', { name: 'Reset checkbox' });
  const sw = page.getByRole('switch', { name: 'Reset switch' });
  const radioA = page.getByRole('radio', { name: 'Reset radio a' });
  const radioB = page.getByRole('radio', { name: 'Reset radio b' });
  await checkbox.uncheck();
  await sw.uncheck();
  await radioB.check();
  await page.locator('#reset-form').evaluate((form) => {
    form.addEventListener('reset', (event) => event.preventDefault(), { once: true });
    (form as HTMLFormElement).reset();
  });
  await expect(checkbox).not.toBeChecked();
  await expect(sw).not.toBeChecked();
  await expect(radioB).toBeChecked();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveJSProperty('indeterminate', true);
  await expect(sw).toBeChecked();
  await expect(radioA).toBeChecked();
});

test('shadow-root controls restore initial state and respect cancelled resets', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const path = '/tests/fixtures/baseUiRegressionsFixture.tsx';
    const { mountBaseUiRegressionsFixture } = (await import(
      path
    )) as typeof import('../fixtures/baseUiRegressionsFixture');
    const container = document.createElement('div');
    container.id = 'shadow-controls';
    document.body.append(container);
    const root = container.attachShadow({ mode: 'open' });
    const host = document.createElement('div');
    root.append(host);
    mountBaseUiRegressionsFixture(host);
  });
  const root = page.locator('#shadow-controls');
  const checkbox = root.getByRole('checkbox', { name: 'Reset checkbox' });
  const sw = root.getByRole('switch', { name: 'Reset switch' });
  const radioA = root.getByRole('radio', { name: 'Reset radio a' });
  const radioB = root.getByRole('radio', { name: 'Reset radio b' });
  await expect(checkbox).toHaveJSProperty('indeterminate', true);
  await checkbox.uncheck();
  await sw.uncheck();
  await radioB.check();
  await root.locator('#reset-form').evaluate((form) => {
    form.addEventListener('reset', (event) => event.preventDefault(), { once: true });
    (form as HTMLFormElement).reset();
  });
  await expect(checkbox).not.toBeChecked();
  await expect(sw).not.toBeChecked();
  await expect(radioB).toBeChecked();
  await root.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveJSProperty('indeterminate', true);
  await expect(sw).toBeChecked();
  await expect(radioA).toBeChecked();
  await checkbox.uncheck();
  await root.getByRole('button', { name: 'Dispose controls' }).click();
  await root.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(checkbox).not.toBeChecked();
});

test('controlled resets request initial values and disposed handles stop listening', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Sync controlled' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#calls')).toHaveText('radio:a');
  await expect(page.getByRole('checkbox', { name: 'Controlled checkbox' })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Controlled radio b' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Reset checkbox' }).uncheck();
  await page.getByRole('button', { name: 'Dispose controls' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Reset checkbox' })).not.toBeChecked();
});

test('roving reconciles disabled and selected attribute mutations', async ({ page }) => {
  const a = page.getByRole('tab', { name: 'Tab A' });
  const b = page.getByRole('tab', { name: 'Tab B' });
  await expect(a).toHaveAttribute('tabindex', '0');
  await a.evaluate((element) => element.setAttribute('aria-disabled', 'true'));
  await expect(a).toHaveAttribute('tabindex', '-1');
  await expect(b).toHaveAttribute('tabindex', '0');
  await a.evaluate((element) => {
    element.removeAttribute('aria-disabled');
    element.setAttribute('aria-selected', 'false');
  });
  await b.evaluate((element) => element.setAttribute('aria-selected', 'true'));
  await expect(b).toHaveAttribute('tabindex', '0');
  await b.evaluate((element) => element.setAttribute('disabled', ''));
  await expect(a).toHaveAttribute('tabindex', '0');
  await expect(b).toHaveAttribute('tabindex', '-1');
});

test('configuration updates rendered orientation in each composite', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure', exact: true }).click();
  for (const role of ['tablist', 'radiogroup', 'toolbar'] as const)
    await expect(page.getByRole(role)).toHaveAttribute('aria-orientation', 'vertical');
});

test('navigation bindings move to changed values and handles', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Mutable navigation' });
  const content = page.getByText('Mutable content', { exact: true });
  await trigger.click();
  await expect(content).toBeVisible();
  await page.getByRole('button', { name: 'Change value', exact: true }).click();
  await expect(content).toBeHidden();
  await trigger.click();
  await expect(content).toBeVisible();
  await page.getByRole('button', { name: 'Change handle', exact: true }).click();
  await expect(content).toBeHidden();
  await page.getByRole('button', { name: 'Show second handle', exact: true }).click();
  await expect(content).toBeVisible();
  await page.getByRole('button', { name: 'Show old handle', exact: true }).click();
  await expect(content).toBeHidden();
});

test('menubar triggers observe disabled bar state', async ({ page }) => {
  const trigger = page.getByRole('menuitem', { name: 'Disabled menu' });
  await expect(trigger).toBeDisabled();
  await page.getByRole('button', { name: 'Enable bar' }).click();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('caller handlers run first and cancel menu and tooltip behavior', async ({ page }) => {
  const outside = page.locator('#outside');
  await outside.focus();
  await page
    .getByRole('menuitem', { name: 'Prevent item focus' })
    .dispatchEvent('pointermove', { cancelable: true });
  await expect(page.locator('#calls')).toHaveText('pointermove');
  await expect(outside).toBeFocused();
  const submenu = page.getByRole('menuitem', { name: 'Prevent submenu' });
  for (const event of ['pointerenter', 'click']) {
    await submenu.dispatchEvent(event, { cancelable: true });
    await expect(page.locator('#calls')).toHaveText(event);
    await expect(submenu).toHaveAttribute('aria-expanded', 'false');
  }
  const tooltip = page.getByRole('button', { name: 'Prevent tooltip' });
  for (const event of ['pointerenter', 'focus']) {
    await tooltip.dispatchEvent(event, { cancelable: true });
    await expect(page.locator('#calls')).toHaveText(event);
    await expect(tooltip).toHaveAttribute('aria-expanded', 'false');
  }
  await page.getByRole('button', { name: 'Show tooltip state' }).dispatchEvent('click');
  for (const event of ['pointerleave', 'blur', 'keydown']) {
    await tooltip.dispatchEvent(event, { cancelable: true, key: 'Escape' });
    await expect(page.locator('#calls')).toHaveText(event);
    await expect(tooltip, `cancelled ${event}`).toHaveAttribute('aria-expanded', 'true');
  }
});

test('ArrowLeft focuses the last selected combobox chip', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Chip input' }).press('ArrowLeft');
  await expect(page.getByText('Blue chip', { exact: true })).toBeFocused();
});

test('RTL horizontal thumbs mirror placement, track clicks and drag direction', async ({
  page,
}) => {
  const viewport = page.getByTestId('rtl-viewport');
  const track = page.getByTestId('rtl-track');
  const thumb = page.getByTestId('rtl-thumb');
  const trackBox = (await track.boundingBox())!;
  const thumbBox = (await thumb.boundingBox())!;
  expect(thumbBox.x + thumbBox.width).toBeCloseTo(trackBox.x + trackBox.width, 0);
  await track.click({ position: { x: 15, y: 5 } });
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeLessThan(-700);
  await viewport.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect
    .poll(() => thumb.boundingBox().then((box) => box!.x))
    .toBeGreaterThan(trackBox.x + 150);
  const start = (await thumb.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 45, start.y + start.height / 2);
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeLessThan(-100);
});

test('Field descriptions merge caller IDs and track mounted parts', async ({ page }) => {
  const control = page.getByRole('textbox', { name: 'Described input' });
  await expect(control).toHaveAttribute('aria-describedby', 'caller-help');
  await page.getByRole('button', { name: 'Toggle description' }).click();
  const description = await page.getByText('Description', { exact: true }).getAttribute('id');
  await expect(control).toHaveAttribute('aria-describedby', `caller-help ${description}`);
  await page.getByRole('button', { name: 'Toggle error' }).click();
  const error = await page.getByText('Error', { exact: true }).getAttribute('id');
  await expect(control).toHaveAttribute('aria-describedby', `caller-help ${description} ${error}`);
  await page.getByRole('button', { name: 'Toggle description' }).click();
  await expect(control).toHaveAttribute('aria-describedby', `caller-help ${error}`);
  await page.getByRole('button', { name: 'Toggle error' }).click();
  await expect(control).toHaveAttribute('aria-describedby', 'caller-help');
});

test('DOM and virtual anchors share the positioning style contract', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const positioningPath = '/packages/base-ui/src/positioning.ts';
    const floatingPath = '/packages/base-ui/src/floating-menu.tsx';
    const { placeElement } = (await import(
      positioningPath
    )) as typeof import('../../packages/base-ui/src/positioning');
    const { positionFloating } = (await import(
      floatingPath
    )) as typeof import('../../packages/base-ui/src/floating-menu');
    const anchor = document.createElement('div');
    anchor.style.cssText =
      'position:fixed;left:100px;top:100px;width:80px;height:20px;direction:rtl';
    const dom = document.createElement('div');
    const virtual = document.createElement('div');
    dom.style.cssText = virtual.style.cssText = 'width:40px;height:30px;direction:rtl';
    document.body.append(anchor, dom, virtual);
    placeElement(anchor, dom, { side: 'bottom', align: 'start', offset: 6, alignOffset: 2 });
    positionFloating({ getBoundingClientRect: () => anchor.getBoundingClientRect() }, virtual, {
      side: 'bottom',
      align: 'start',
      sideOffset: 6,
      alignOffset: 2,
    });
    const snapshot = (element: HTMLElement) => ({
      style: element.style.cssText,
      side: element.dataset.side,
      align: element.dataset.align,
    });
    return { dom: snapshot(dom), virtual: snapshot(virtual) };
  });
  expect(result.dom).toEqual(result.virtual);
  expect(result.dom.style).toContain('--anchor-width: 80px');
  expect(result.dom.style).toContain('--transform-origin:');
});
