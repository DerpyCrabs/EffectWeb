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
  for (const rule of ['valid-view'] as const) {
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
    const reports: { loc?: { line: number }; message: string }[] = [];
    plugin.rules['render-safety']
      .create({
        filename: 'arrays.tsx',
        sourceCode: { text },
        options: [],
        report: (diagnostic) => reports.push(diagnostic),
      })
      .Program();
    expect(reports.map((report) => report.loc?.line)).toEqual([3, 4]);
    expect(reports[0]!.message).toContain('mutating method sort');
    expect(reports[1]!.message).toContain('randomness');
  });

  it('reports every independent finding in one view', () => {
    const text = `import { view } from 'effectweb';
const Busy = view((model) => {
  const sorted = model.items.sort();
  return (
    <p title={String(Date.now())}>
      {sorted.join(',')}
      {Math.random()}
    </p>
  );
});`;
    expect(lint(text, 'busy.tsx').map((d) => [d.line, d.code])).toEqual([
      [3, 'EW1003'],
      [5, 'EW1003'],
      [7, 'EW1003'],
    ]);
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
    const reports: { loc?: { line: number; column: number }; message: string }[] = [];
    const context = {
      filename: 'views.tsx',
      sourceCode: { text: source },
      options: [],
      report: (d: (typeof reports)[number]) => reports.push(d),
    };
    plugin.rules['render-safety'].create(context).Program();
    expect(reports.map((d) => d.loc?.line)).toEqual([2, 4]);
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
  expect(lint(text, 'identity.tsx').map((d) => d.code)).toEqual(['EW3001']);
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

it('surfaces parser or native-analysis failures through the correctness rule', () => {
  const reports: { message: string }[] = [];
  plugin.rules['valid-view']
    .create({
      filename: 'queries.ts',
      sourceCode: { text: `import {view} from 'effectweb'; const q = view({` },
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

describe('optional identity lint: keyed rows', () => {
  const run = (text: string) => {
    const reports: { loc?: { line: number }; message: string }[] = [];
    plugin.rules.identity
      .create({
        filename: 'rows.tsx',
        sourceCode: { text },
        options: [],
        report: (report) => reports.push(report),
      })
      .Program();
    return reports;
  };

  it('rejects JSX map even for literal tuples and records', () => {
    const text = `import { view } from 'effectweb';
import { Field } from './Field';
const A = view(m => <div>{[['id', 'Id'], ['name', 'Name']].map(([k, l]) => <Field id={k} label={l} />)}</div>);
const B = view(m => <div>{[{ id: 'a', label: \`A\` }].map(o => <Field id={o.id} label={o.label} />)}</div>);
const C = view(m => <div>{[[m.key, 'Label']].map(([k, l]) => <Field id={k} label={l} />)}</div>);`;
    expect(run(text).map((report) => report.loc?.line)).toEqual([3, 4, 5]);
  });

  it('reports .map rows containing components or form controls', () => {
    const text = `import { view, list, entities } from 'effectweb';
import { Row } from './Row';
const A = view(m => <ul>{m.rows.map(r => <Row row={r} />)}</ul>);
const B = view(m => <ul>{m.rows.map((r) => (<li><input value={r.name} /></li>))}</ul>);
const C = view(m => <ul>{m.rows.map(function (r) { if (r.hidden) return null; return <li>{r.edit ? <textarea /> : r.name}</li>; })}</ul>);
const D = view(m => <ul>{m.rows.map(r => <li>{r.name}</li>)}</ul>);
const E = view(m => <ul>{['a', 'b'].map(k => <Row row={k} />)}</ul>);
const F = view(m => <ul>{list(entities(m.rows), r => <Row row={r} />)}</ul>);
const G = view(m => <ul>{m.rows.map(r => <li contentEditable>{r.name}</li>)}</ul>);
const H = view(m => <ul>{(['a', 'b'] as const).map(k => <Row row={k} />)}</ul>);
const I = view(m => <ul>{(m.wide ? ['a', 'b'] : ['a']).filter(k => k !== m.skip).map(k => <Row row={k} />)}</ul>);
const J = view(m => <ul>{(m.wide ? m.rows : ['a']).map(k => <Row row={k} />)}</ul>);`;
    const reports = run(text);
    expect(reports.map((report) => report.loc?.line)).toEqual([3, 4, 5, 6, 7, 9, 10, 11, 12]);
    expect(reports[0]!.message).toContain('[EW3001]');
    expect(reports[0]!.message).toContain('list(entities(rows), render)');
  });

  it.each([
    "['a', 'b'].filter(k => k !== m.skip)",
    "['a', 'b'].slice(m.start)",
    "(m.flip ? ['b', 'a'] : ['a', 'b'])",
    '[...m.rows]',
  ])('warns when literal-derived rows can shift: %s', (rows) => {
    const text = `import {view} from 'effectweb';view(m=><div>{${rows}.map(k=><input value={k}/>)}</div>);`;
    expect(run(text).some((report) => report.message.includes('[EW3001]'))).toBe(true);
  });

  it('never affects compilation or other rules', () => {
    const text = `import { view } from 'effectweb';
import { Row } from './Row';
const A = view(m => <ul>{m.rows.map(r => <Row row={r} />)}</ul>);`;
    expect(lint(text, 'rows.tsx').map((d) => [d.code, d.severity, d.category])).toEqual([
      ['EW3001', 'error', 'identity'],
    ]);
    expect(diagnose(text, 'rows.tsx')).toEqual([]);
    expect(() => compile(text, 'rows.tsx')).not.toThrow();
  });
});

describe('optional identity lint: stable bindings', () => {
  it('reports DOM binding setup functions created during render', () => {
    const text = `import { view, domMount, domBinding as bind } from 'effectweb';
const setup = (element, points) => () => {};
const focus = domMount((element) => element.focus());
const A = view(m => <canvas use={bind(m.points, setup)} />);
const B = view(m => <canvas use={bind(m.points, (element, points) => () => {})} />);
const C = view(m => { const host = domMount(() => () => {}); return <input use={host} />; });
const D = view(m => <input use={focus} />);
const E = () => <input use={domMount(function () { return () => {}; })} />;`;
    const reports: { loc?: { line: number }; message: string }[] = [];
    plugin.rules.identity
      .create({
        filename: 'bindings.tsx',
        sourceCode: { text },
        options: [],
        report: (report) => reports.push(report),
      })
      .Program();
    expect(reports.map((report) => report.loc?.line)).toEqual([5, 6, 8]);
    expect(reports[0]!.message).toContain('[EW3002]');
    expect(lint(text, 'bindings.tsx').filter((d) => d.code === 'EW3002')).toHaveLength(3);
    expect(diagnose(text, 'bindings.tsx')).toEqual([]);
  });
});

describe('optional identity lint: stable sources', () => {
  it('reports sources created while rendering an observation', () => {
    const text = `import { view, observe, mapSource, clock } from 'effectweb';
const minute = clock(60_000);
export function make(owner) {
  const total = mapSource(owner.source, (s) => s.total);
  const A = view(() => <p>{observe(total, (t) => t)}</p>);
  const B = view(() => <p>{observe(mapSource(owner.source, (s) => s.total), (t) => t)}</p>);
  const C = view(() => <p>{observe(minute, (now) => now)}</p>);
  const D = view(() => <p>{observe(clock(1000), (now) => now)}</p>);
  return [A, B, C, D];
}`;
    expect(
      lint(text, 'sources.tsx')
        .filter((d) => d.code === 'EW3004')
        .map((d) => d.line),
    ).toEqual([6, 8]);
  });

  it('reports collections created while rendering', () => {
    const text = `import { view, list, collection } from 'effectweb';
const byCode = collection((row) => row.code);
const quotes = id => ['quote', id];
export const A = view((m) => <ul>{list(byCode.from(m.rows), (r) => <li>{r.code}</li>)}</ul>);
export const B = view((m) => <ul>{list(collection((row) => row.code).from(m.rows), (r) => <li>{r.code}</li>)}</ul>);
export const C = view((m) => <button onClick={() => m.run(['quote', m.id])}>{m.id}</button>);
export const D = view((m) => <button onClick={() => m.run(quotes(m.id))}>{m.id}</button>);`;
    expect(
      lint(text, 'constructors.tsx')
        .filter((d) => d.code === 'EW3004')
        .map((d) => d.line),
    ).toEqual([5]);
  });
});

describe('optional identity lint: positional rows and fresh slots', () => {
  const codes = (text: string, file: string, options = {}) =>
    lint(text, file, options).map((d) => `${d.code}@${d.line}`);

  it('reports sequence rows with editable controls or filtered components', () => {
    const text = `import { view, list, sequence } from 'effectweb';
import { Row } from './Row';
export const A = view((m) => <ul>{list(sequence(m.rows), (r) => <li><input value={r.t} /></li>)}</ul>);
export const B = view((m) => <ul>{list(sequence(m.rows.filter((r) => r.t)), (r) => <Row t={r.t} />)}</ul>);
export const C = view((m) => <ul>{list(sequence(m.rows), (r) => <Row t={r.t} />)}</ul>);
export const D = view((m) => <ul>{list(sequence(m.rows), (r) => <input disabled value={r.t} />)}</ul>);
export const E = view((m) => <ul>{list(sequence(m.rows.slice(0, m.count)), (r) => <Row t={r.t} />)}</ul>);
export const F = view(() => <ul>{list(sequence(['a', 'b']), (r) => <input value={r} />)}</ul>);`;
    expect(codes(text, 'rows.tsx')).toEqual(['EW3005@3', 'EW3005@4']);
  });

  it('reports identity derived from the row index, except as a fallback', () => {
    const text = `import { collection } from 'effectweb';
export const a = collection((row, index) => \`\${row.at}:\${index}\`);
export const b = collection(function (row, index) { return index; });
export const c = collection((row, index) => row.id || \`unsaved:\${index}\`);
export const d = collection((row) => row.id);`;
    expect(codes(text, 'collections.ts')).toEqual(['EW3006@2', 'EW3006@3']);
  });

  it('checks views declared with function expressions', () => {
    const text = `import { view } from 'effectweb';
export const A = view(function (m) { return <b>{Date.now() - m.a}</b>; });`;
    expect(codes(text, 'function.tsx')).toEqual(['EW1003@2']);
  });

  it('checks files importing only adapter packages and every JSX file without a foreign pragma', () => {
    const adapter = `import { Icon } from '@effectweb/lucide';
export const rows = (m) => <ul>{m.rows.map((r) => <input value={r.id} />)}</ul>;`;
    expect(codes(adapter, 'adapter.tsx')).toEqual(['EW3001@2']);
    const local = `import { Row } from './Row';
export const rows = (m) => <ul>{m.rows.map((r) => <Row id={r.id} />)}</ul>;`;
    expect(codes(local, 'local.tsx')).toEqual(['EW3001@2']);
    expect(compile(local, 'local.tsx').code).not.toContain('<ul>');
    const foreign = `/** @jsxImportSource react */
export const rows = (m) => <ul>{m.rows.map((r) => <input key={r.id} />)}</ul>;`;
    expect(codes(foreign, 'foreign.tsx')).toEqual([]);
    expect(compile(foreign, 'foreign.tsx').code).toBe(foreign);
  });

  it('treats rows with a DOM binding as stateful', () => {
    const text = `import { view, domMount } from 'effectweb';
const focus = domMount((el) => el.focus());
export const A = view((m) => <ul>{m.rows.map((r) => <li use={focus}>{r.t}</li>)}</ul>);
export const B = view((m) => <ul>{m.rows.map((r) => <li>{r.t}</li>)}</ul>);`;
    expect(codes(text, 'bindings.tsx')).toEqual(['EW3001@3', 'EW3001@4']);
  });

  it('reads the JSX pragma only from comments before the first statement', () => {
    const text = `import { view } from 'effectweb';
/** Islands elsewhere set @jsxImportSource react; this file is EffectWeb. */
export const A = view((m) => <p key={m.id} />);`;
    expect(diagnose(text, 'prose.tsx')).toEqual([expect.objectContaining({ code: 'EW1001' })]);
    const foreign = `/** @jsxImportSource react */
import { mount } from 'effectweb';
export const A = () => <p key="x" />;`;
    expect(diagnose(foreign, 'island.tsx')).toEqual([]);
  });

  it('reports identity derived from the row index in an inline list identity', () => {
    const text = `import { view, list } from 'effectweb';
export const A = view((m) => <ul>{list(m.rows, (row, index) => index, (row) => <li>{row.t}</li>)}</ul>);
export const B = view((m) => <ul>{list(m.rows, (row) => row.id, (row) => <li>{row.t}</li>)}</ul>);`;
    expect(codes(text, 'inline.tsx')).toEqual(['EW3006@2']);
  });
});

it('rejects hook-style names for functions and constants', () => {
  const reports: { message: string }[] = [];
  const visitors = plugin.rules['no-hook-names'].create({
    filename: 'names.ts',
    sourceCode: { text: '' },
    options: [],
    report: (report) => reports.push(report),
  });
  visitors.FunctionDeclaration({ id: { type: 'Identifier', name: 'useWorkspace' } });
  visitors.VariableDeclarator({
    id: { type: 'Identifier', name: 'useFileIcon' },
    init: { type: 'ArrowFunctionExpression' },
  });
  visitors.VariableDeclarator({
    id: { type: 'Identifier', name: 'useStore' },
    init: { type: 'CallExpression' },
  });
  visitors.VariableDeclarator({
    id: { type: 'Identifier', name: 'useCurrent' },
    init: { type: 'LogicalExpression' },
  });
  visitors.VariableDeclarator({ id: { type: 'Identifier', name: 'useLater' } });
  visitors.VariableDeclarator({
    id: { type: 'Identifier', name: 'userName' },
    init: { type: 'CallExpression' },
  });
  visitors.VariableDeclarator({ id: { type: 'ObjectPattern' } });
  visitors.FunctionDeclaration({ id: null });
  expect(reports.map((report) => report.message.slice(0, 22))).toEqual([
    '[EW3007] useWorkspace ',
    '[EW3007] useFileIcon r',
    '[EW3007] useStore read',
  ]);
});

it('publishes the same preset rules for JSON and JavaScript configurations', async () => {
  const { effectwebLint } = await import('./preset.js');
  const json = (await import('./oxlint-preset.json', { with: { type: 'json' } })).default;
  expect(effectwebLint.rules).toEqual(json.rules);
  expect(
    Object.keys(plugin.rules)
      .map((name) => `effectweb/${name}`)
      .sort(),
  ).toEqual(
    Object.keys(json.rules)
      .filter((name) => name.startsWith('effectweb/'))
      .sort(),
  );
});

it('lints non-array JSX map without making compilation fail', () => {
  const source = `import { view } from 'effectweb';
const option = { map: fn => fn('x') };
export const A = view(() => option.map(value => <b>{value}</b>));`;
  expect(lint(source, 'option.tsx').filter((d) => d.code === 'EW3001')).toHaveLength(1);
  expect(() => compile(source, 'option.tsx')).not.toThrow();
});
