import { expect, test } from '@playwright/test';

test('failed bindings, branches and cleanups leave siblings usable and release acquired work', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const domPath = '/tests/fixtures/runtime.ts',
      programPath = '/tests/fixtures/runtime.ts';
    const { compiled, element, text, branch, mountView } = (await import(
      domPath
    )) as typeof import('effectweb/dom');
    const { program } = (await import(programPath)) as typeof import('effectweb/program');
    const errors: unknown[] = [],
      disposed: number[] = [];
    const source = program({
      initial: 0,
      update: (_: number, value: number) => ({ model: value }),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const view = compiled<number, number>((scope, parent, before) => {
      const first = element(parent, before, 'output');
      first.id = 'first';
      text(
        scope,
        first,
        null,
        () => [scope.value],
        () => {
          if (scope.value === 1) throw new Error('binding');
          return scope.value;
        },
      );
      branch(
        scope,
        parent,
        before,
        () => scope.value > 0,
        (child, parent, before) => {
          child.cleanups.push(
            () => {
              disposed.push(1);
              throw new Error('cleanup');
            },
            () => {
              disposed.push(2);
            },
          );
          if (child.value === 1) throw new Error('branch');
          element(parent, before, 'aside').textContent = 'recovered';
        },
        () => {},
      );
      const second = element(parent, before, 'output');
      second.id = 'second';
      text(
        scope,
        second,
        null,
        () => [scope.value],
        () => scope.value,
      );
    });
    const stop = mountView(host, view, source, {
      onError: (error) => {
        errors.push(error);
      },
    });
    source.send(1);
    const partial = [
      host.querySelector('#first')?.textContent,
      host.querySelector('#second')?.textContent,
    ];
    source.send(2);
    const recovered = host.querySelector('aside')?.textContent;
    stop();
    stop();
    source.dispose();
    return {
      partial,
      recovered,
      disposed,
      errorCount: errors.length,
      children: host.childNodes.length,
    };
  });
  expect(result).toEqual({
    partial: ['0', '1'],
    recovered: 'recovered',
    disposed: [2, 1, 2, 1],
    errorCount: 4,
    children: 0,
  });
});

test('static templates clone independently in HTML and SVG namespaces', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { template, element, attribute, literal } = (await import(
      path
    )) as typeof import('effectweb/dom');
    let builds = 0;
    const stamp = template((parent, before) => {
      builds++;
      const root = element(parent, before, 'a');
      attribute(root, 'class', 'static');
      literal(root, null, 'Original');
    });
    const html = document.createElement('div'),
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stamp(html, null);
    html.firstElementChild!.textContent = 'Changed';
    stamp(html, null);
    stamp(svg, null);
    stamp(svg, null);
    return {
      builds,
      html: html.textContent,
      svg: svg.textContent,
      htmlNS: html.firstElementChild!.namespaceURI,
      svgNS: svg.firstElementChild!.namespaceURI,
    };
  });
  expect(result).toEqual({
    builds: 2,
    html: 'ChangedOriginal',
    svg: 'OriginalOriginal',
    htmlNS: 'http://www.w3.org/1999/xhtml',
    svgNS: 'http://www.w3.org/2000/svg',
  });
});

test('the independent reading-list app persists edits and keeps existing row nodes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/examples/reading-list/index.html');
  await expect(page.getByRole('status')).toContainText('saved entries');
  await page
    .getByRole('textbox', { name: 'Book or article' })
    .fill('Designing Data-Intensive Applications');
  await page.getByRole('button', { name: 'Add to list' }).click();
  const row = page.locator('li').filter({ hasText: 'Designing Data-Intensive Applications' });
  await row.getByRole('checkbox').check();
  await expect(page.getByRole('status')).toHaveText('1 saved entries');
  await page.evaluate(() => {
    document.querySelector('li')!.setAttribute('data-retained', 'yes');
  });
  await page
    .getByRole('textbox', { name: 'Book or article' })
    .fill('A Philosophy of Software Design');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(row).toHaveAttribute('data-retained', 'yes');
  await expect(page.getByRole('status')).toHaveText('2 saved entries');
  await page.reload();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await page.getByRole('textbox', { name: 'Filter' }).fill('philosophy');
  await expect(page.locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove A Philosophy of Software Design' }).click();
  await expect(page.getByRole('status')).toHaveText('1 saved entries');
  expect(errors).toEqual([]);
});

test('the same reading-list UI also runs with synchronous Effect storage', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const appPath = '/examples/reading-list/app.tsx',
      storagePath = '/examples/reading-list/memoryStorage.ts';
    const { mountReadingList } = (await import(
      appPath
    )) as typeof import('../../examples/reading-list/app');
    const { memoryStorage } = (await import(
      storagePath
    )) as typeof import('../../examples/reading-list/memoryStorage');
    mountReadingList(
      document.body,
      memoryStorage([{ id: 'one', title: 'Working Effectively with Legacy Code', read: false }]),
    );
  });
  await expect(page.getByRole('status')).toHaveText('1 saved entries');
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Remove Working Effectively with Legacy Code' }).click();
  await expect(page.getByRole('status')).toHaveText('0 saved entries');
});
