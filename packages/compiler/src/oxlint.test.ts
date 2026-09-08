import { describe, expect, it } from 'vitest';
import { compile, diagnose } from './compile.js';
import plugin from './oxlint.js';

const source = `import { view as render } from 'effectweb';
const A = render(model => { const x = model.items.sort(); return <p>{x}</p>; });
const B = render(model => <p>{model.title}</p>);
const C = render(model => { const x = Math.random(); return <p>{x}</p>; });`;

describe('compiler diagnostics in lint', () => {
  it('rejects computed mutations while accepting a copied-array derivation', () => {
    const text = `import { view } from 'effectweb';
const Safe = view(model => <p>{[...model.items].sort().join(',')}</p>);
const Bad = view(model => <p>{model.items["sort"]().join(',')}</p>);
const Random = view(model => <p>{Math["random"]()}</p>);`;
    const reports: { loc: { line: number }; message: string }[] = [];
    plugin.rules['valid-view']
      .create({
        filename: 'arrays.tsx',
        sourceCode: { text },
        options: [],
        report: (diagnostic) => reports.push(diagnostic),
      })
      .Program();
    expect(reports.map((report) => report.loc.line)).toEqual([3, 4]);
    expect(reports[0]!.message).toContain('mutating method sort');
    expect(reports[1]!.message).toContain('randomness');
  });

  it('uses compiler errors, continues to later views, and keeps valid views silent', () => {
    const diagnostics = diagnose(source, 'views.tsx');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => [d.line, d.severity])).toEqual([
      [2, 'error'],
      [4, 'error'],
    ]);
    expect(() => compile(source, 'views.tsx')).toThrow(diagnostics[0]!.message);
  });

  it('recovers from lowering failures before checking later views', () => {
    const text = `import { view } from 'effectweb';
const Recursive=view(model => { const again=() => <div>{again()}</div>; return again(); });
const Good=view(model => <div><span>valid</span></div>);
const Bad=view(model => <ui.Button />);`;
    const diagnostics = diagnose(text, 'recovery.tsx');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.message).toContain('Recursive JSX');
    expect(diagnostics[1]!.line).toBe(4);
    expect(diagnostics[1]!.message).toContain('namespace or member');
  });

  it('reports UTF-16 columns at the failing expression', () => {
    const source = `import { view } from 'effectweb'; const face = '😀'; const A=view(model => { const x=model.items.sort(); return <p>{x}</p>; });`;
    const diagnostic = diagnose(source, 'unicode.tsx')[0]!;
    expect(diagnostic.column).toBe(source.indexOf('model.items.sort()') + 1);
  });

  it('supports custom imports and separates errors from performance advice', () => {
    const text = `import { view } from './ui'; const A=view(model => <p>{format(model)}</p>);`;
    expect(diagnose(text, 'custom.tsx')).toEqual([]);
    expect(diagnose(text, 'custom.tsx', { importSource: './ui' })).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('whole model') as unknown,
      }),
    ]);
    const reports: { message: string }[] = [];
    const context = {
      filename: 'custom.tsx',
      sourceCode: { text },
      options: [{ importSource: './ui' }],
      report: (d: { message: string }) => reports.push(d),
    };
    plugin.rules['valid-view'].create(context).Program();
    expect(reports).toEqual([]);
    plugin.rules['whole-model-dependency'].create(context).Program();
    expect(reports).toHaveLength(1);
  });

  it('does not reuse diagnostics after an editor changes a file', () => {
    const reports: { loc: { line: number; column: number }; message: string }[] = [];
    const context = {
      filename: 'views.tsx',
      sourceCode: { text: source },
      options: [],
      report: (d: (typeof reports)[number]) => reports.push(d),
    };
    plugin.rules['valid-view'].create(context).Program();
    expect(reports.map((d) => d.loc.line)).toEqual([2, 4]);
    reports.length = 0;
    plugin.rules['valid-view']
      .create({
        ...context,
        sourceCode: {
          text: `import {view} from 'effectweb'; const A=view(model => <p>{model.title}</p>);`,
        },
      })
      .Program();
    expect(reports).toEqual([]);
    context.sourceCode.text = `import {view} from 'effectweb'; const A=view(model => <p>{model.title}</p>);`;
    plugin.rules['valid-view'].create(context).Program();
    expect(reports).toEqual([]);
  });

  it('ignores unrelated functions and files outside the TypeScript compiler contract', () => {
    expect(
      diagnose(`function view(f) { return f; } const A=view(model => {model.x++;});`, 'other.tsx'),
    ).toEqual([]);
    const reports: unknown[] = [];
    plugin.rules['valid-view']
      .create({
        filename: 'other.js',
        sourceCode: { text: source },
        options: [],
        report: (d) => reports.push(d),
      })
      .Program();
    expect(reports).toEqual([]);
  });
});

it.each([
  `const A = view(model => <>{([{id: 'a'}] as const).map(item => <p>{item.id}</p>)}</>);`,
  `const A = view(model => <>{[{id: 'a'}].map(item => <p>{item.id}</p>)}</>);`,
  `type Item = {id: string}; type Model = {items: readonly Item[]}; const A = view<Model>(model => <>{model.items.map(item => <p>{item.id}</p>)}</>);`,
  `interface Item {id: string} interface Model {items: ReadonlyArray<Item>} const A = view((model: Model) => <>{model.items.filter(item => item.id).map(item => <p>{item.id}</p>)}</>);`,
  `const A = view(model => { const items: {id: string}[] = model.items; return <>{items.map(item => <p>{item.id}</p>)}</>; });`,
])('rejects statically known raw object lists: %s', (body) => {
  const text = `import {view} from 'effectweb'; ${body}`;
  const diagnostic = diagnose(text, 'identity.tsx')[0]!;
  expect(diagnostic).toMatchObject({ code: 'EW1002', category: 'correctness', severity: 'error' });
  expect(diagnostic.remedy).toContain('entities(items)');
  expect(diagnostic.remedy).toContain('sequence(items)');
  expect(() => compile(text, 'identity.tsx')).toThrow('[EW1002]');
});

it('accepts explicit collections, primitive lists, and unproven imported types', () => {
  const text = `import {view, entities, sequence} from 'effectweb'; import type {Remote} from './types';
  type Model = {items: {id: string}[], names: string[]};
  const A = view<Model>(model => <>{entities(model.items).map(item => <p>{item.id}</p>)}{sequence(model.items).map(item => <p>{item.id}</p>)}{model.names.map(name => <p>{name}</p>)}</>);
  const B = view<Remote>(model => <>{model.items.map(item => <p>{item.id}</p>)}</>);`;
  expect(diagnose(text, 'explicit.tsx')).toEqual([]);
});

it('gives mutable captures and performance advice distinct actionable categories', () => {
  const text = `import {view} from 'effectweb'; let outside = 1; const A = view(model => <p>{outside}</p>); const B = view(model => <p>{format(model)}</p>);`;
  expect(diagnose(text, 'categories.tsx')).toEqual([
    expect.objectContaining({
      code: 'EW2001',
      category: 'unprovable-dependency',
      severity: 'error',
      remedy: expect.stringContaining('model') as unknown,
    }),
    expect.objectContaining({
      code: 'EW3001',
      category: 'performance',
      severity: 'warning',
      remedy: expect.stringContaining('fields') as unknown,
    }),
  ]);
});

it.each([
  `key: ({account, page}) => [account], load: ({account, page}) => api(account, page)`,
  `key: args => args.account, load: args => api(args.account, args.page)`,
  `key: () => 'fixed', load: args => api(args.page)`,
  `key: ({account: owner}) => [owner], load: ({page: cursor}) => api(cursor)`,
])('rejects legacy query projections through native analysis and TS lint', (definition) => {
  const text = `import {query as defineQuery} from 'effectweb'; const q = defineQuery({name: 'page', ${definition}});`;
  expect(diagnose(text, 'queries.ts')[0]).toMatchObject({
    code: 'EW2002',
    severity: 'error',
    remedy: expect.stringContaining('every request argument') as unknown,
  });
  const reports: unknown[] = [];
  plugin.rules['query-key']
    .create({
      filename: 'queries.ts',
      sourceCode: { text },
      options: [],
      report: (report) => reports.push(report),
    })
    .Program();
  expect(reports).toHaveLength(1);
});

it.each([
  `key: args => [args.account, args.page], load: args => api(args.account, args.page)`,
  `key: args => makeKey(args), load: args => api(args.page)`,
  `key: buildKey, load: args => api(args.page)`,
  `key: ({account, ...rest}) => [account, rest], load: args => api(args.page)`,
])('rejects projections even when their completeness is unprovable: %s', (definition) => {
  expect(
    diagnose(`import {query} from 'effectweb'; const q = query({${definition}});`, 'queries.ts')[0],
  ).toMatchObject({ code: 'EW2002', severity: 'error' });
});

it('accepts complete automatic request identity', () => {
  expect(
    diagnose(
      `import {query} from 'effectweb'; const q = query({load: args => api(args.filter.status)});`,
      'queries.ts',
    ),
  ).toEqual([]);
});

it('recognizes query subpath imports without treating unrelated query functions as framework calls', () => {
  const definition = `{key: args => args.account, load: args => api(args.page)}`;
  expect(
    diagnose(
      `import {query} from 'effectweb/query'; const q = query(${definition});`,
      'queries.ts',
    )[0]?.code,
  ).toBe('EW2002');
  expect(
    diagnose(`import {query} from './other'; const q = query(${definition});`, 'queries.ts'),
  ).toEqual([]);
});

it('surfaces parser or native-analysis failures when query-key is used on TypeScript', () => {
  const reports: { message: string }[] = [];
  plugin.rules['query-key']
    .create({
      filename: 'queries.ts',
      sourceCode: { text: `import {query} from 'effectweb'; const q = query({` },
      options: [],
      report: (report) => reports.push(report),
    })
    .Program();
  expect(reports[0]?.message).toContain('[EW1000]');
});

it('checks scalar views in .ts through the same correctness rule', () => {
  const reports: { message: string }[] = [];
  plugin.rules['valid-view']
    .create({
      filename: 'scalar.ts',
      options: [],
      sourceCode: {
        text: "import { view } from 'effectweb/dom'; const V = view(m => Math.random());",
      },
      report: (d) => reports.push(d),
    })
    .Program();
  expect(reports).toHaveLength(1);
  expect(reports[0]!.message).toContain('randomness');
});
