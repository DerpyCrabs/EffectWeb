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
        message: expect.stringContaining('whole model'),
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

  it('ignores unrelated functions and does not lint non-TSX files', () => {
    expect(
      diagnose(`function view(f) { return f; } const A=view(model => {model.x++;});`, 'other.tsx'),
    ).toEqual([]);
    const reports: unknown[] = [];
    plugin.rules['valid-view']
      .create({
        filename: 'other.ts',
        sourceCode: { text: source },
        options: [],
        report: (d) => reports.push(d),
      })
      .Program();
    expect(reports).toEqual([]);
  });
});
