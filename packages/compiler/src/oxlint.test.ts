import { describe, expect, it } from 'vitest';
import { compile, diagnose, lint } from './compile.js';
import plugin from './oxlint.js';

const source = `import { view as render } from 'effectweb';
const A = render(model => { const x = model.items.sort(); return <p>{x}</p>; });
const B = render(model => <p>{model.title}</p>);
const C = render(model => { const x = Math.random(); return <p>{x}</p>; });`;

it('reports JSX errors in JavaScript files supported by the compiler', () => {
  const text = `import {view} from 'effectweb'; const App=view(model=><p>{model.count++}</p>);`;
  const reports: { message: string }[] = [];
  plugin.rules['render-safety']
    .create({
      filename: 'view.jsx',
      sourceCode: { text },
      options: [],
      report: (report) => reports.push(report),
    })
    .Program();
  expect(reports).toHaveLength(1);
  expect(reports[0]!.message).toContain('mutate');
  expect(() => compile(text, 'view.jsx')).not.toThrow();
  expect(diagnose(text, 'view.jsx')).toEqual([]);
});

it('accepts ordinary helper imports with the default lint and compiler options', () => {
  const text = `import {view} from 'effectweb';import {format} from './format';view(m=><p>{format(m.value)}</p>);`;
  for (const rule of ['valid-view', 'query-key'] as const) {
    const reports: unknown[] = [];
    plugin.rules[rule]
      .create({
        filename: 'contracts.tsx',
        sourceCode: { text },
        options: [],
        report: (report) => reports.push(report),
      })
      .Program();
    expect(reports).toEqual([]);
  }
  expect(diagnose(text, 'contracts.tsx')).toEqual([]);
});

describe('optional render-safety lint', () => {
  it('rejects computed mutations while accepting a copied-array derivation', () => {
    const text = `import { view } from 'effectweb';
const Safe = view(model => <p>{[...model.items].sort().join(',')}</p>);
const Bad = view(model => <p>{model.items["sort"]().join(',')}</p>);
const Random = view(model => <p>{Math["random"]()}</p>);`;
    const reports: { loc: { line: number }; message: string }[] = [];
    plugin.rules['render-safety']
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

  it('reports lint findings in later views without affecting compilation', () => {
    const diagnostics = lint(source, 'views.tsx');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => [d.line, d.severity])).toEqual([
      [2, 'error'],
      [4, 'error'],
    ]);
    expect(() => compile(source, 'views.tsx')).not.toThrow();
    expect(diagnose(source, 'views.tsx')).toEqual([]);
  });

  it('collects JSX syntax failures in later expressions', () => {
    const text = `import {view} from 'effectweb';
const A=view(model=><p key={model.id}/>);
const B=view(model=><ui.Button/>);
const C=view(model=><p ref={model.ref}/>);`;
    expect(diagnose(text, 'syntax.tsx').map((d) => [d.line, d.code])).toEqual([
      [2, 'EW1001'],
      [4, 'EW1001'],
    ]);
  });

  it('reports UTF-16 columns at the failing expression', () => {
    const source = `import { view } from 'effectweb'; const face = '😀'; const A=view(model => { const x=model.items.sort(); return <p>{x}</p>; });`;
    const diagnostic = lint(source, 'unicode.tsx')[0]!;
    expect(diagnostic.column).toBe(source.indexOf('model.items.sort()') + 1);
  });

  it('supports configured imports without advising against normal whole-model rendering', () => {
    const text = `import {view} from './ui';const format=model=>model.title;const A=view(model=><p>{format(model)}</p>);`;
    expect(diagnose(text, 'custom.tsx', { importSource: './ui' })).toEqual([]);
    expect(lint(text, 'custom.tsx', { importSource: './ui' })).toEqual([]);
  });

  it('does not reuse diagnostics after an editor changes a file', () => {
    const reports: { loc: { line: number; column: number }; message: string }[] = [];
    const context = {
      filename: 'views.tsx',
      sourceCode: { text: source },
      options: [],
      report: (d: (typeof reports)[number]) => reports.push(d),
    };
    plugin.rules['render-safety'].create(context).Program();
    expect(reports.map((d) => d.loc.line)).toEqual([2, 4]);
    reports.length = 0;
    plugin.rules['render-safety']
      .create({
        ...context,
        sourceCode: {
          text: `import {view} from 'effectweb'; const A=view(model => <p>{model.title}</p>);`,
        },
      })
      .Program();
    expect(reports).toEqual([]);
    context.sourceCode.text = `import {view} from 'effectweb'; const A=view(model => <p>{model.title}</p>);`;
    plugin.rules['render-safety'].create(context).Program();
    expect(reports).toEqual([]);
  });

  it('ignores unrelated functions and files outside the TypeScript compiler contract', () => {
    expect(
      diagnose(`function view(f) { return f; } const A=view(model => {model.x++;});`, 'other.tsx'),
    ).toEqual([]);
    const reports: unknown[] = [];
    plugin.rules['render-safety']
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

it('keeps list identity explicit without classifying ordinary map calls', () => {
  const text = `import {view,list,entities} from 'effectweb';
  const A=view(model=><>{model.items.map(item=><b>{item.id}</b>)}</>);
  const B=view(model=><>{list(entities(model.items),item=><b>{item.id}</b>)}</>);`;
  expect(lint(text, 'identity.tsx')).toEqual([]);
  expect(diagnose(text, 'identity.tsx')).toEqual([]);
});

it('accepts explicit collections, primitive lists, and unproven imported types', () => {
  const text = `import {view, entities, sequence} from 'effectweb'; import type {Remote} from './types';
  type Model = {items: {id: string}[], names: string[]};
  const A = view<Model>(model => <>{entities(model.items).map(item => <p>{item.id}</p>)}{sequence(model.items).map(item => <p>{item.id}</p>)}{model.names.map(name => <p>{name}</p>)}</>);
  const B = view<Remote>(model => <>{model.items.map(item => <p>{item.id}</p>)}</>);`;
  expect(diagnose(text, 'explicit.tsx')).toEqual([]);
});

it('reports mutable captures without inferring render dependencies', () => {
  const text = `import {view} from 'effectweb';const format=model=>model.title; let outside = 1; const A = view(model => <p>{outside}</p>); const B = view(model => <p>{format(model)}</p>);`;
  expect(lint(text, 'categories.tsx')).toEqual([
    expect.objectContaining({
      code: 'EW2001',
      category: 'unprovable-dependency',
      severity: 'error',
      remedy: expect.stringContaining('model') as unknown,
    }),
  ]);
});

it.each([
  `key: ({account, page}) => [account], load: ({account, page}) => api(account, page)`,
  `key: args => args.account, load: args => api(args.account, args.page)`,
  `key: () => 'fixed', load: args => api(args.page)`,
  `key: ({account: owner}) => [owner], load: ({page: cursor}) => api(cursor)`,
])('reports legacy query projections through optional lint', (definition) => {
  const text = `import {query as defineQuery} from 'effectweb'; const q = defineQuery({name: 'page', ${definition}});`;
  expect(lint(text, 'queries.ts')[0]).toMatchObject({
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
    lint(`import {query} from 'effectweb'; const q = query({${definition}});`, 'queries.ts')[0],
  ).toMatchObject({ code: 'EW2002', severity: 'error' });
});

it('accepts complete automatic request identity', () => {
  expect(
    lint(
      `import {query} from 'effectweb'; const q = query({load: args => api(args.filter.status)});`,
      'queries.ts',
    ),
  ).toEqual([]);
});

it('recognizes query subpath imports without treating unrelated query functions as framework calls', () => {
  const definition = `{key: args => args.account, load: args => api(args.page)}`;
  expect(
    lint(`import {query} from 'effectweb/query'; const q = query(${definition});`, 'queries.ts')[0]
      ?.code,
  ).toBe('EW2002');
  expect(
    lint(`import {query} from './other'; const q = query(${definition});`, 'queries.ts'),
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
  plugin.rules['render-safety']
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
