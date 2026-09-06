import { describe, expect, it } from 'vitest';
import { compile as compileSource } from './compile';

const compile = (source: string) =>
  compileSource(`import { view } from 'effectweb'; ${source}`, 'contract.tsx').code;

describe('snapshot JSX compiler contract', () => {
  it('compiles JSX constants, helper arguments and ordinary child inputs with captured callbacks', () => {
    const code = compile(
      `const Demo=view((model,send)=>{const caption=<b>{model.title}</b>;const row=(label)=> <Child label={label} click={()=>send(model.id)}/>;return <section>{caption}{row(model.label)}</section>;});`,
    );
    expect(code).toContain('.invoke(');
    expect(code).toContain('.child(');
    expect(code).not.toContain('<Child');
  });

  it('compiles destructuring, derivations, events and keyed domain maps to direct DOM', () => {
    const code = compile(`const Demo = view((model, send) => {
      const { title } = model;
      const label = title.toUpperCase();
      return <section><h1>{label}</h1>{model.rows.map(row => <button onClick={() => send({ id: row.id })}>{row.text}</button>)}</section>;
    });`);
    expect(code).toContain('.compiled(');
    expect(code).toContain('.derive(');
    expect(code).toContain('.each(');
    expect(code).toContain('.event(');
    expect(code).not.toContain('<section');
    expect(code).not.toContain('createSignal');
    expect(code).not.toContain('Proxy');
  });
  it('keeps optional dependencies safe and callback parameters lexical', () => {
    const code = compile(
      `const Demo = view((model, send) => <p>{model.user ? model.user.name : 'none'}{model.rows.filter(model => model.visible).length}</p>);`,
    );
    expect(code).toMatch(/\.filter\(\s*\(?([A-Za-z_$][\w$]*)\)?\s*=>\s*\1\.visible\)/u);
    expect(code).toContain('?.user');
  });
  it('rejects recursive JSX before expanding dependencies', () => {
    expect(() =>
      compile(`view((model, send) => {
      const row = () => <>{row()}{row()}</>;
      return row();
    })`),
    ).toThrow('Recursive JSX');
  });

  it.each([
    [`view((model, send) => { let x = model.x; return <p>{x}</p>; })`, 'Mutable capture'],
    [`view((model, send) => <p {...model} />)`, 'spreads'],
    [`view((model, send) => <p key={model.id} />)`, 'Identity belongs'],
    [`view((model, send) => <button onClick={async () => send(await load())} />)`, 'commands'],
    [`view((model, send) => { const x = model.count++; return <p>{x}</p>; })`, 'mutate'],
    [`let external = 1; view((model, send) => <p>{external}</p>)`, 'Mutable capture'],
    [`view((model, send) => model.flag || <p />)`, 'Unsupported JSX'],
    [
      `view((model, send) => { const helper = () => caption; const caption = <b>{model.title}</b>; return <section>{helper()}</section>; })`,
      'Forward captures',
    ],
  ])(
    'rejects unsupported semantics instead of silently compiling stale code',
    (source, message) => {
      expect(() => compile(source)).toThrow(message);
    },
  );
});

it('points at the mutation expression and rejects builtin mutations', () => {
  for (const expression of [
    'model.items.sort()',
    'model.items.push(1)',
    'model.cache.set("a", 1)',
    'delete model.title',
    'Math.random()',
  ]) {
    expect(() =>
      compile(
        `const Demo = view((model, send) => {\n const title = ${expression};\n return <p>{title}</p>;\n});`,
      ),
    ).toThrow(/(?:contract\.tsx:2:|>\s*2\s*\|)/u);
  }
});

it.each([
  'model.items["sort"]()',
  'model.items[`reverse`]()',
  '(model.items["push"] as Function)(1)',
  'model.items?.["splice"]?.(0, 1)',
  'model.cache["set"]("a", 1)',
  'Math["random"]()',
  '(Math)[`random`]()',
])('checks computed builtin calls like dot notation: %s', (expression) => {
  expect(() => compile(`view(model => <p>{${expression}}</p>)`)).toThrow(
    /mutating method|randomness/u,
  );
});

it.each([
  '[...model.items].sort((a, b) => a - b)',
  '([...model.items] as number[])["reverse"]()',
  '[...model.items][`splice`](0, 1)',
])('allows mutation of a fresh array without mutating the snapshot: %s', (expression) => {
  expect(compile(`view(model => <p>{(${expression}).join(",")}</p>)`)).toContain('.compiled(');
});

it('still checks work inside a fresh-array comparator', () => {
  expect(() =>
    compile('view(model => <p>{[...model.items].sort(() => model.other["pop"]()).join(",")}</p>)'),
  ).toThrow('mutating method pop');
  expect(() => compile('view(model => <p>{[...model.groups][0].sort().join(",")}</p>)')).toThrow(
    'mutating method sort',
  );
});

it('keeps computed service actions and shadowed Math methods available', () => {
  expect(
    compile('view(model => <Dialog confirm={() => model.service["delete"](model.id)} />)'),
  ).toContain('.child(');
  expect(compile('view(({ Math }) => <p>{Math["random"]()}</p>)')).toContain('.compiled(');
});

it('resolves a configured public runtime without an application-root path', () => {
  const code = compileSource(
    `import { view } from '@example/view'; const Demo = view((model, send) => <b>Hello</b>);`,
    'public.tsx',
    { importSource: '@example/view' },
  ).code;
  expect(code).toMatch(/from ['"]@example\/view\/dom['"]/u);
  expect(code).toContain('.template(');
  expect(code).not.toContain('/src/ui');
  expect(code).not.toContain('.watch(');
});

it('emits dependency explanations only in development and flags broad helper inputs', () => {
  const diagnostics: unknown[] = [];
  const source = `import { view } from 'effectweb'; const Demo = view((model, send) => { const label = format(model); return <p title={model.title}>{label}</p>; });`;
  const dev = compileSource(source, 'demo.tsx', {
    development: true,
    onDiagnostic: (value) => diagnostics.push(value),
  }).code;
  const prod = compileSource(source, 'demo.tsx').code;
  expect(dev).toContain('model.title');
  expect(dev).toContain('format(model)');
  expect(diagnostics).toHaveLength(1);
  expect(prod).not.toContain('dependencies:');
});

it('compiles early returns, branch constants, grouped switch cases and JSX helpers', () => {
  const code = compile(`const Demo = view((model, send) => {
    const row = (item) => {
      if (item.hidden) return null;
      switch (item.kind) {
        case 'first':
        case 'second': { const label = item.title.toUpperCase(); return <b>{label}</b>; }
        default: return <i>{item.title}</i>;
      }
    };
    if (model.loading) return <p>Loading</p>;
    if (model.error) { const label = model.error.message; return <p>{label}</p>; }
    return <section>{model.rows.map(item => {
      if (item.hidden) return null;
      return row(item);
    })}</section>;
  });`);
  expect(code).toContain('.branch(');
  expect(code).toContain('.invoke(');
  expect(code).toMatch(/===?\s*['"]first['"]/u);
  expect(code).not.toContain('<section');
});

it.each([
  [`view((model, send) => { if (model.ready) return <b/>; })`, 'Every view path'],
  [
    `view((model, send) => { switch(model.kind) { case 'a': break; default: return <b/>; } })`,
    'Switch cases must return',
  ],
  [
    `view((model, send) => { switch(model.kind) { case 'a': const label = model.title; case 'b': return <b/>; } return null; })`,
    'Switch cases must return',
  ],
  [
    `view((model, send) => { switch(model.kind) { case 'a': } return null; })`,
    'Switch labels need',
  ],
  [`view((model, send) => { return <b/>; const unused = model.title; })`, 'unreachable'],
])('diagnoses unsupported or incomplete control flow', (source, message) => {
  expect(() => compile(source)).toThrow(message);
});

it('only lowers calls bound to framework imports, including aliases', () => {
  const code = compileSource(
    `
    import { view as snapshot } from 'effectweb';
    export const Demo = snapshot((model, send) => <b>{model.title}</b>);
    function unrelated(snapshot: (fn: () => number) => number) {
      return snapshot(() => 17);
    }
  `,
    'bindings.tsx',
  ).code;
  expect(code.match(/\.compiled\(/gu)).toHaveLength(1);
  expect(code).toMatch(/return\s+snapshot\(/u);
});

it('preserves files with no framework view calls', () => {
  const source = 'export const answer: number = 42;';
  const result = compileSource(source, 'ordinary.tsx');
  expect(result.code).toContain('answer');
  expect(result.code).not.toContain('snapshotDom');
  expect(result.diagnostics).toEqual([]);
});

it('reports original source locations and content in usable source maps', () => {
  const source = [
    "import { view } from 'effectweb';",
    'export const marker = 17;',
    '',
    'export const Demo = view((model, send) => {',
    '  return <button title={model.label}>{model.label}</button>;',
    '});',
  ].join('\n');
  const result = compileSource(source, '/project/source-map.tsx');
  expect(result.map).not.toBeNull();
  const map = JSON.parse(result.map!) as {
    version: number;
    sources: string[];
    sourcesContent: string[];
    mappings: string;
  };
  expect(map.version).toBe(3);
  expect(map.sources.some((path) => path.endsWith('source-map.tsx'))).toBe(true);
  expect(map.sourcesContent).toContain(source);
  // Decode VLQ source positions rather than merely accepting a nonempty map.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let originalLine = 0;
  const mappedLines = new Set<number>();
  for (const line of map.mappings.split(';')) {
    for (const segment of line.split(',')) {
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (const character of segment) {
        const digit = alphabet.indexOf(character);
        expect(digit).toBeGreaterThanOrEqual(0);
        value += (digit & 31) * 2 ** shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        values.push((value & 1 ? -1 : 1) * Math.floor(value / 2));
        value = 0;
        shift = 0;
      }
      if (values.length >= 4) {
        originalLine += values[2]!;
        mappedLines.add(originalLine);
      }
    }
  }
  expect(mappedLines.has(1)).toBe(true); // The ordinary declaration remains debuggable.
  expect(mappedLines.has(4)).toBe(true); // Generated DOM work maps back to its JSX.
});

it('compiles children, named JSX props and imported typed slots without evaluating markup closures', () => {
  const code = compileSource(
    `import { view, slot as snippet } from 'effectweb';
    const Demo = view((model, send) => {
      const row = snippet((value: string) => <button onClick={() => send(model.id)}>{value}:{model.title}</button>);
      return <Panel row={row} footer={<b>{model.title}</b>}><input value={model.title}/></Panel>;
    });`,
    'slots.tsx',
  ).code;
  expect(code.match(/\.compiledSlot\(/gu)).toHaveLength(3);
  expect(code).not.toContain('<Panel');
  expect(code).not.toContain('snippet(');
  expect(code).toContain('children:');
});

it.each([
  [`<Panel children={<b/>}><i/></Panel>`, 'Pass children once'],
  [`<Panel row={slot(async value => <b>{value}</b>)} />`, 'Slots take'],
  [`<Panel row={slot(({ name }) => <b>{name}</b>)} />`, 'destructure'],
  [`<Panel row={slot((first, second) => <b>{first}{second}</b>)} />`, 'Slots take'],
])('rejects ambiguous children and unsupported slot signatures: %s', (markup, message) => {
  expect(() =>
    compileSource(
      `import { view, slot } from 'effectweb'; const Demo = view((model, send) => ${markup});`,
      'slots.tsx',
    ),
  ).toThrow(message);
});

it('compiles a view with no dispatch parameter', () => {
  expect(compile('const Title = view((model) => <h1>{model.title}</h1>);')).toContain('.compiled(');
});
it('does not claim unrelated modules named mvu', () => {
  const source =
    "import { view } from '../mvu'; const Title = view((model) => <h1>{model.title}</h1>);";
  expect(compileSource(source, 'other.tsx').code).toBe(source);
  expect(
    compileSource(source, 'custom.tsx', { importSource: '../mvu', runtimeModule: 'effectweb/dom' })
      .code,
  ).toContain('.compiled(');
});

it('allows native input resets and deferred browser access inside event callbacks', () => {
  expect(
    compile(`view((model, send) => <input onChange={event => {
    send(event.currentTarget.value);
    event.currentTarget.value = '';
    queueMicrotask(() => requestAnimationFrame(() => document.getElementById(model.next)?.focus()));
  }} />)`),
  ).toContain('.event(');
});
it.each([
  'view(model => <p>{document.title}</p>)',
  'view(model => <button onClick={document.getElementById(model.id)} />)',
  'view(model => <p title={(() => document.title)()} />)',
  'view(model => <p title={(() => model.items.sort())()} />)',
  'view((model, send) => <input onChange={event => { model.title = event.currentTarget.value; }} />)',
])('keeps render work and model mutations subject to purity checks: %s', (source) => {
  expect(() => compile(source)).toThrow();
});

it('allows imperative service calls in a custom component callback prop', () => {
  expect(
    compile('view(model => <Dialog confirm={() => model.service.delete(model.id)} />)'),
  ).toContain('.child(');
});

it('lowers simple destructured input directly to field dependencies', () => {
  const code = compile('view(({ title: label, user: { name } }: Props) => <p>{label}{name}</p>)');
  expect(code).toContain('["title"]');
  expect(code).toContain('["user"]');
  expect(code).not.toContain('.derive(');
});
it.each([
  'view(({ title = "Untitled", ...rest }: Props) => <p>{title}{rest.extra}</p>)',
  'view(([first, second = first, ...rest]: Props) => <p>{first}{second}{rest.length}</p>)',
  'view(({ title = (() => { const inner = "default"; return inner; })() }: Props) => <p>{title}</p>)',
])('preserves defaults and rest bindings without leaking their inner variables: %s', (source) => {
  expect(compile(source)).toContain('.compiled(');
});
it('rejects destructured dispatch and defaults that capture dispatch', () => {
  expect(() => compile('view((model, { send }) => <p />)')).toThrow('dispatch');
  expect(() => compile('view(({ action = () => send(1) }, send) => <p />)')).toThrow('defaults');
});
