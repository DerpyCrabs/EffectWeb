import { expect, it } from 'vitest';
import { compile, diagnose, lint } from './compile.js';
import plugin from './oxlint.js';

it.each([
  `import {format} from './missing-at-compile-time';view(m=><p>{format(m.label)}</p>);`,
  `import * as arbitrary from 'ordinary-library';view(m=><p>{arbitrary.format(m.label)}</p>);`,
  `const custom={slice:(value:string)=>value};view(m=><p>{custom.slice(m.label)}</p>);`,
  `view((m:{data:{sort:()=>string}})=><p>{m.data.sort()}</p>);`,
  `const Math={random:(value:string)=>value};view(m=><p>{Math.random(m.label)}</p>);`,
  `view(m=><p>{m.format?.(m.label)}</p>);`,
  `view(m=><>{m.rows.map(row=><p>{row.label}</p>)}</>);`,
])('compiles ordinary typed values without contracts or runtime method guards: %s', (body) => {
  const source = `import {view} from 'effectweb';${body}`;
  for (const development of [true, false]) {
    const result = compile(source, 'typed-boundary.tsx', { development });
    expect(result.code).toContain('.markup(');
    expect(result.code).not.toContain('.intrinsic(');
    expect(result.diagnostics).toEqual([]);
    expect(diagnose(source, 'typed-boundary.tsx')).toEqual([]);
  }
});

it.each([
  `view(m=><p>{m.items.sort().join(',')}</p>);`,
  `let ambient=1;view(m=><p>{ambient}</p>);`,
  `view(m=><p>{Math.random()}</p>);`,
  `view(m=><button onClick={async()=>{await m.action()}}/>);`,
  `import {Effect} from 'effect';view(m=><p>{Effect.runSync(m.effect)}</p>);`,
])('keeps optional lint findings out of compilation: %s', (body) => {
  const source = `import {view} from 'effectweb';${body}`;
  expect(lint(source, 'lint-only.tsx').some((issue) => issue.severity === 'error')).toBe(true);
  expect(diagnose(source, 'lint-only.tsx')).toEqual([]);
  for (const development of [true, false]) {
    expect(compile(source, 'lint-only.tsx', { development }).diagnostics).toEqual([]);
  }
});

it.each([
  ['valid-view', 'render-safety'],
  ['render-safety', 'valid-view'],
] as const)('isolates optional lint diagnostics in the shared cache (%s first)', (...rules) => {
  const sourceCode = { text: `import {view} from 'effectweb';view(m=><p>{Math.random()}</p>);` };
  for (const rule of rules) {
    const reports: unknown[] = [];
    plugin.rules[rule]
      .create({
        filename: 'shared.tsx',
        sourceCode,
        options: [],
        report: (issue) => reports.push(issue),
      })
      .Program();
    expect(reports).toHaveLength(rule === 'render-safety' ? 1 : 0);
  }
});
