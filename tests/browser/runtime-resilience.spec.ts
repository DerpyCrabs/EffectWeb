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

test('mount observes model publications made during synchronous child setup', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { compiled, element, text, mountView, program } = (await import(
      path
    )) as typeof import('../fixtures/runtime');
    const source = program({ initial: 0, update: (_model: number, model: number) => ({ model }) });
    const host = document.createElement('div');
    const View = compiled<number, number>((scope, parent, before) => {
      const node = element(parent, before, 'output');
      text(
        scope,
        node,
        null,
        () => [scope.value],
        () => scope.value,
      );
      source.send(1);
    });
    const stop = mountView(host, View, source);
    const result = { text: host.textContent, model: source.model() };
    stop();
    source.dispose();
    return result;
  });
  expect(result).toEqual({ text: '1', model: 1 });
});

test('disposing a placement during child setup releases the acquired child', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { Scope, compiled, renderComponent, element, text } = (await import(
      path
    )) as typeof import('../fixtures/runtime');
    const host = document.createElement('div');
    let disposed = 0;
    const outer = new Scope({}, () => {});
    const Child = compiled((scope, parent, before) => {
      scope.cleanups.push(() => {
        disposed++;
      });
      outer.dispose();
      element(parent, before, 'span');
    });
    text(
      outer,
      host,
      null,
      () => [],
      () => renderComponent(Child, {}),
    );
    const result = { disposed, children: host.querySelectorAll('span').length };
    outer.dispose();
    return result;
  });
  expect(result).toEqual({ disposed: 1, children: 0 });
});

test('a DOM acquisition keeps its identity and fresh input when setup publishes a model', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { compiled, element, attach, domBinding, mountView, program } = (await import(
      path
    )) as typeof import('../fixtures/runtime');
    const source = program({ initial: 0, update: (_model: number, model: number) => ({ model }) });
    const host = document.createElement('div');
    const errors: unknown[] = [];
    let starts = 0,
      stops = 0,
      observed = -1;
    const acquire = (_element: Element, input: () => number) => {
      starts++;
      if (starts > 3) throw new Error('Repeated acquisition');
      source.send(1);
      observed = input();
      return () => {
        stops++;
      };
    };
    const View = compiled<number, number>((scope, parent, before) => {
      const node = element(parent, before, 'div');
      attach(
        scope,
        node,
        () => [scope.value],
        () => domBinding(scope.value, acquire),
      );
    });
    const stop = mountView(host, View, source, {
      onError: (error) => {
        errors.push(error);
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    source.dispose();
    return { starts, stops, observed, errors: errors.map(String) };
  });
  expect(result).toEqual({ starts: 1, stops: 1, observed: 1, errors: [] });
});

for (const keyed of [true, false]) {
  test(`removing a mounted ${keyed ? 'keyed list' : 'content array'} during a new child setup releases that child`, async ({
    page,
  }) => {
    await page.goto('/');
    const result = await page.evaluate(async (keyed) => {
      const path = '/tests/fixtures/runtime.ts';
      const { compiled, view, renderComponent, list, element, mountView, program } = (await import(
        path
      )) as typeof import('../fixtures/runtime');
      const host = document.createElement('div');
      document.body.append(host);
      const releases: number[] = [];
      const errors: string[] = [];
      let stop = () => {};
      const Child = compiled<{ id: number }, never>((scope, parent, before) => {
        scope.cleanups.push(() => {
          releases.push(scope.value.id);
        });
        if (scope.value.id === 2) stop();
        element(parent, before, 'span').textContent = String(scope.value.id);
      });
      const source = program({
        initial: [1],
        update: (_model: readonly number[], model: readonly number[]) => ({ model }),
      });
      const Root = view<readonly number[], readonly number[]>((model) => {
        const render = (id: number) => renderComponent(Child, { id });
        return keyed ? list(model, render) : model.map(render);
      });
      stop = mountView(host, Root, source, {
        onError: (error) => {
          errors.push(String(error));
        },
      });
      source.send([1, 2]);
      source.dispose();
      const result = { releases, errors, children: host.childNodes.length };
      host.remove();
      return result;
    }, keyed);
    expect(result).toEqual({ releases: [1, 2], errors: [], children: 0 });
  });
  for (const phase of ['update', 'cleanup'] as const) {
    test(`removing a mounted ${keyed ? 'keyed list' : 'content array'} during child ${phase} stops reconciliation`, async ({
      page,
    }) => {
      await page.goto('/');
      const result = await page.evaluate(
        async ({ keyed, phase }) => {
          const path = '/tests/fixtures/runtime.ts';
          const { compiled, view, renderComponent, list, element, mountView, program } =
            (await import(path)) as typeof import('../fixtures/runtime');
          const host = document.createElement('div');
          document.body.append(host);
          const releases: number[] = [];
          const builds: number[] = [];
          const errors: string[] = [];
          let stop = () => {};
          let stopOnCleanup = false;
          const Child = compiled<{ id: number; stopOnUpdate: boolean }, never>(
            (scope, parent, before) => {
              const id = scope.value.id;
              builds.push(id);
              scope.cleanups.push(() => {
                releases.push(id);
                if (stopOnCleanup) stop();
              });
              scope.jobs.push(() => {
                if (scope.value.stopOnUpdate) stop();
              });
              element(parent, before, 'span').textContent = String(id);
            },
          );
          type Model = { ids: readonly number[]; stopOnUpdate: boolean };
          const source = program<Model, Model>({
            initial: { ids: [1, 2], stopOnUpdate: false },
            update: (_model, model) => ({ model }),
          });
          const Root = view<Model, Model>((model) => {
            const render = (id: number) =>
              renderComponent(Child, { id, stopOnUpdate: model.stopOnUpdate });
            return keyed ? list(model.ids, render) : model.ids.map(render);
          });
          stop = mountView(host, Root, source, {
            onError: (error) => {
              errors.push(String(error));
            },
          });
          stopOnCleanup = phase === 'cleanup';
          source.send({
            ids: phase === 'cleanup' ? [3] : [1, 2, 3],
            stopOnUpdate: phase === 'update',
          });
          source.dispose();
          const result = {
            releases: releases.sort((a, b) => a - b),
            builds,
            errors,
            children: host.childNodes.length,
          };
          host.remove();
          return result;
        },
        { keyed, phase },
      );
      expect(result).toEqual({ releases: [1, 2], builds: [1, 2], errors: [], children: 0 });
    });
  }
}

test('positional lists render each sparse-array placeholder with its own identity', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/tests/fixtures/runtime.ts';
    const { view, list, sequence, markup, mountView, program } = (await import(
      path
    )) as typeof import('../fixtures/runtime');
    const host = document.createElement('div');
    const placeholders: undefined[] = [];
    placeholders.length = 3;
    const source = program({ initial: placeholders, update: (model) => ({ model }) });
    const row = markup('b');
    const Root = view<readonly undefined[]>((model) =>
      list(sequence(model), (_item, index) => row({ children: index })),
    );
    const stop = mountView(host, Root, source);
    const result = { text: host.textContent, count: host.querySelectorAll('b').length };
    stop();
    source.dispose();
    return result;
  });
  expect(result).toEqual({ text: '012', count: 3 });
});
