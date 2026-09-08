import { expect, test } from '@playwright/test';

test('inspector shows source dependencies, counts and change reasons; label associations work', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/inspectorFixture.tsx';
    const { mountInspectorFixture } = (await import(
      path
    )) as typeof import('../fixtures/inspectorFixture');
    const app = document.createElement('div'),
      panel = document.createElement('div');
    document.body.append(app, panel);
    const fixture = mountInspectorFixture(app, panel);
    const labels = [...app.querySelectorAll('label')];
    const associations = labels.map((label) => label.control?.id);
    fixture.set({ count: 1 });
    const initialTitleCount = fixture
      .entries()
      .find(
        (entry: { source: { expression: string } }) =>
          entry.source.expression === 'fixed + model.title',
      )?.bindings;
    fixture.set({ title: 'after' });
    await Promise.resolve();
    const updatedAssociation = labels[1]!.control?.id;
    const filter = panel.querySelector('input')!;
    filter.value = 'fixed + model.title';
    filter.dispatchEvent(new Event('input'));
    const row = panel.querySelector('tbody')!.textContent;
    const counts = [...panel.querySelectorAll('tbody tr td')]
      .slice(-2)
      .map((cell) => cell.textContent);
    panel.querySelector('button')!.click();
    await Promise.resolve();
    const cleared = panel.querySelectorAll('tbody tr').length;
    fixture.dispose();
    const removed = panel.childNodes.length;
    app.remove();
    panel.remove();
    return { associations, updatedAssociation, initialTitleCount, row, counts, cleared, removed };
  });
  expect(result.associations).toEqual(['static-input', 'before']);
  expect(result.updatedAssociation).toBe('after');
  expect(result.initialTitleCount).toBe(1);
  expect(result.row).toContain('fixed + model.title');
  expect(result.row).toContain('Changed: model.title');
  expect(result.row).not.toContain('Changed: fixed');
  expect(result.counts).toEqual(['0', '2']);
  expect(result.cleared).toBe(0);
  expect(result.removed).toBe(0);
});
