import { describe, expect, it } from 'vitest';
import { compile as compileSource } from './compile';

const compile = (source: string) =>
  compileSource(`import { view } from 'effectweb'; ${source}`, 'contract.tsx').code;

it.each([
  `let external='old'; const read=()=>external; view(model=><p>{read()}</p>);`,
  `let external='old'; function read(){return external;} const label=()=>read(); view(model=><p>{label()}</p>);`,
  `const clock=Date; view(model=><p>{clock.now()}</p>);`,
  `const clock=Date; const now=()=>clock.now(); view(model=><p>{now()}</p>);`,
  `let external='old'; const read=()=>external; const alias=read; view(model=><p>{alias()}</p>);`,
  `let external='old'; const read=()=>external; view(model=>{const alias=read;return <p>{alias()}</p>;});`,
])('diagnoses mutable render dependencies hidden by same-file helpers: %s', (source) => {
  expect(() => compile(source)).toThrow(/Mutable capture|Read Date/u);
});

it.each([
  `const ambient={count:0}; const read=()=>++ambient.count;`,
  `const ambient={count:0}; function read(){ambient.count=1;return 1;}`,
  `const ambient={count:0}; const mutate=()=>delete ambient.count; const read=mutate;`,
  `const ambient=[]; const read=()=>ambient.push(1);`,
  `const ambient=new Map(); const read=()=>ambient.set('key',1);`,
  `const ambient=[]; const alias=ambient; const mutate=()=>alias.reverse(); const read=()=>mutate();`,
  `const read=(input)=>{const alias=input;alias.count++;return alias.count;};`,
  `const read=(input)=>{const copy={input};copy.input.count++;return 1;};`,
  `const read=(input)=>{const copy=[input];let i=0;copy[i].count++;return 1;};`,
  `const read=()=>globalThis.Date.now();`,
  `const clock=globalThis;const read=()=>clock['Date'].now();`,
  `const read=()=>globalThis.Math.random();`,
  `const read=()=>performance.now();`,
])('rejects mutation and ambient reads through render helper calls: %s', (source) => {
  expect(() => compile(`${source} view(model=><b>{read(model.value)}</b>);`)).toThrow(
    /mutate|mutating method|Read /u,
  );
});

it.each([
  `const read=(input)=>{const result=[];result.push(input);return result.length;};`,
  `const read=(input)=>{const result={count:input};result.count++;return result.count;};`,
  `const read=(input)=>{const result={count:input};delete result.count;return 0;};`,
  `const read=(input)=>{const result=[];const alias=result;alias.push(input);return result.length;};`,
  `const read=(input)=>{const result=structuredClone(input);result.nested.count++;return result;};`,
  `const read=(input)=>{const result=input.slice();result.sort();return result.length;};`,
  `const read=(input)=>{let result=input;result++;return result;};`,
  `const read=(input)=>{const globalThis=input;return globalThis.Date.now();};`,
])('allows pure helpers to mutate their own bindings and fresh buffers: %s', (source) => {
  expect(compile(`${source} view(model=><b>{read(model.value)}</b>);`)).toContain('.compiled(');
});

it.each([
  `let observer; const observe=()=>{observer=window.innerWidth;return ()=>{};}; const mount=()=>domMount(()=>observe()); view(model=><div use={mount()}/>);`,
  `const mount=()=>domMount(element=>{const width=document.documentElement.clientWidth;element.style.width=width+'px';return ()=>{};}); view(model=><div use={mount()}/>);`,
  `const mount=()=>domMount(element=>Effect.gen(function*(){let visible=true;const motion=window.matchMedia('screen');visible=false;yield* Effect.never;})); view(model=><div use={mount()}/>);`,
  `const mount=()=>domBinding('input',()=>{consume(Math.random(),localStorage.getItem('key'));return ()=>{};}); view(model=><div use={mount()}/>);`,
  `view(model=><div use={domMount(()=>consume(window.innerWidth))}/>);`,
  `const mount=()=>domMount(()=>Effect.tryPromise(async()=>{await import('player');await Promise.resolve();}));view(model=><div use={mount()}/>);`,
])('keeps DOM host callback work deferred through render helpers: %s', (source) => {
  expect(compile(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toContain(
    '.compiled(',
  );
});

it.each([
  `const acquire=()=>window.innerWidth; const host=()=>domMount(acquire); view(model=><div use={host()}/>);`,
  `view(model=>{const acquire=()=>Math.random();return <div use={domMount(acquire)}/>;});`,
  `const host=()=>{const acquire=()=>window.innerWidth;return domMount(acquire);}; view(model=><div use={host()}/>);`,
  `const host=()=>{const acquire=()=>Math.random();const alias=acquire;return domBinding('data',alias);}; view(model=><div use={host()}/>);`,
  `const mount=domMount; const host=()=>mount(()=>window.innerWidth); view(model=><div use={host()}/>);`,
  `const host=()=>mount(()=>document.title); const first=domMount; const mount=first; view(model=><div use={host()}/>);`,
  `const bind=domBinding; const host=()=>bind('data',()=>document.title); view(model=><div use={host()}/>);`,
  `const host=()=>{function acquire(){return document.title;}return domMount(acquire);}; view(model=><div use={host()}/>);`,
])(
  'preserves deferred acquisition through immutable callback and factory bindings: %s',
  (source) => {
    expect(compile(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toContain(
      '.compiled(',
    );
  },
);

it.each([
  `const host=()=>{const acquire=()=>window.innerWidth;domMount(acquire);return acquire();}; view(model=><div use={host()}/>);`,
  `view(model=>{const acquire=()=>Math.random();const host=domMount(acquire);return <div use={host}>{acquire()}</div>;});`,
  `const acquire=()=>window.innerWidth;const host=()=>{domMount(acquire);return acquire();}; view(model=><div use={host()}/>);`,
  `const host=()=>{const acquire=()=>Math.random();domMount(acquire);return [1].map(acquire);}; view(model=><div use={host()}/>);`,
  `const host=()=>{const acquire=()=>document.title;const alias=acquire;domMount(alias);return alias();}; view(model=><div use={host()}/>);`,
  `let acquire=()=>window.innerWidth;const host=()=>domMount(acquire);view(model=><div use={host()}/>);`,
  `let mount=domMount;mount=other;const host=()=>mount(()=>window.innerWidth);view(model=><div use={host()}/>);`,
  `let mount=domMount;const host=()=>mount(()=>window.innerWidth);view(model=><div use={host()}/>);`,
  `const mount=domMount;const acquire=()=>window.innerWidth;const host=()=>mount(acquire());view(model=><div use={host()}/>);`,
  `const mount=domMount;const host=()=>mount(make(window.innerWidth));view(model=><div use={host()}/>);`,
  `const bind=domBinding;const host=()=>bind(document.title,()=>{});view(model=><div use={host()}/>);`,
])('checks eager or mutable uses of host callback and factory bindings: %s', (source) => {
  expect(() => compile(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toThrow(
    /Read window|Read document|randomness|Mutable capture/u,
  );
});

it('recognizes aliased host imports and the mount subpath', () => {
  expect(
    compile(
      `import { domMount as mount } from 'effectweb/mount'; const host=()=>mount(function(){consume(document.title);return ()=>{};}); view(model=><div use={host()}/>);`,
    ),
  ).toContain('.compiled(');
});

it.each([
  `const mount=()=>domMount(make(window.innerWidth)); view(model=><div use={mount()}/>);`,
  `const mount=()=>domBinding(document.title,()=>{}); view(model=><div use={mount()}/>);`,
  `const mount=()=>domMount(()=>{},window.runtime); view(model=><div use={mount()}/>);`,
  `const mount=()=>domMount((()=>{consume(document.title);return ()=>{};})()); view(model=><div use={mount()}/>);`,
  `function mount(domMount){return domMount(()=>document.title);} view(model=><div use={mount(model.factory)}/>);`,
  `const mount=()=>{const title=document.title;return domMount(()=>consume(title));}; view(model=><div use={mount()}/>);`,
  `const mount=()=>{consume(Math.random());return domMount(()=>{});}; view(model=><div use={mount()}/>);`,
])('still checks work executed while creating a DOM host: %s', (source) => {
  expect(() => compile(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toThrow(
    /Read window|Read document|randomness/u,
  );
});

it('keeps borrowed model mutations rejected inside DOM host callbacks', () => {
  expect(() =>
    compile(
      `import { domMount } from 'effectweb'; view(model=><div use={domMount(()=>{model.items.push(1);})}/>);`,
    ),
  ).toThrow(/mutating method/u);
});

it.each([
  `view(model=><button onClick={()=>{model.items.push(1);}}/>);`,
  `view(model=>{const items=model.items;return <button onClick={()=>{items.reverse();}}/>;});`,
  `view(({items})=><button onClick={()=>{items.splice(0,1);}}/>);`,
  `view(model=><Dialog confirm={()=>{model.items.sort();}}/>);`,
  `view(model=><div>{model.rows.map(row=><button onClick={()=>{row.items.push(1);}}/>)}</div>);`,
])('rejects array mutation through model aliases in callbacks: %s', (source) => {
  expect(() => compile(source)).toThrow(/mutating method/u);
});

it('permits event-time randomness without requiring an extracted helper', () => {
  expect(compile(`view((model,send)=><button onClick={()=>send(Math.random())}/>);`)).toContain(
    '.bindEvent(',
  );
  expect(
    compile(
      `const random=()=>Math.random();view((model,send)=><button onClick={()=>send(random())}/>);`,
    ),
  ).toContain('.bindEvent(');
});

it('keeps pure helper locals and event-only work outside render capture checks', () => {
  expect(
    compile(
      `const format=(value)=>{let result=value;result+=1;return result;};view(model=><p>{format(model.count)}</p>);`,
    ),
  ).toContain('.compiled(');
  expect(
    compile(
      `const actions=defineActions({Run:()=>Date.now()});view((model,send)=>{const dispatch=actions.bind(send);return <button onClick={()=>dispatch.Run()}/>;});`,
    ),
  ).toContain('.bindEvent(');
  expect(
    compile(
      `view(model=><button onClick={()=>{const local=[];local.push(model.id);consume(local);}}/>);`,
    ),
  ).toContain('.bindEvent(');
  expect(compile(`const clock=Date; view(model=><p>{clock.UTC(model.year,0,1)}</p>);`)).toContain(
    '.compiled(',
  );
});

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
    expect(code).toContain('.bindEvent(');
    expect(code).toContain('.template(');
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
  expect(code).toContain('.template(');
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
  ).toContain('.bindEvent(');
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

it('keeps constants fixed and shares direct child prop dependencies without merging callback caches', () => {
  const code = compile(`const Child = view(props => <p>{props.title}</p>);
    const Parent = view((model, send) => <Child title={model.title} count={model.count} label="fixed" click={() => send(model.id)} />);`);
  expect(code.match(/\.derive\(/gu)).toHaveLength(2);
  expect(code).toContain('return (() =>');
  expect(code).toContain('.value');
});

it('captures snapshots inside event handlers while preserving Effect-returning bodies', () => {
  const code = compile(`const Demo = view((model, send) => <button onClick={event => {
    send({count:model.count + 1});
    return effectEvent('drop', () => task(model.count, event)) (event);
  }}>Go</button>);`);
  expect(code).toContain('.bindEvent(');
  expect(code).toContain('return effectEvent(');
  expect(code).not.toContain('dispatchEvent');
  expect(code).not.toContain('synchronousProgram');
});

it.each([
  '<table><tr><td>{model.text}</td></tr></table>',
  '<p><div>{model.text}</div></p>',
  '<button><button>{model.text}</button></button>',
  '<table><svg><circle r="1" /></svg></table>',
  '<svg><g data-Mixed="kept" /></svg>',
])('keeps exact native construction where HTML parsing would change the tree: %s', (jsx) => {
  expect(compile(`const Demo = view(model => ${jsx});`)).toContain('.template(');
});

it('serializes static label associations as native for attributes', () => {
  const code = compile(
    'const Label = view(model => <div><label htmlFor="name">Name</label><span>{model.title}</span></div>);',
  );
  expect(code).toContain('for=\\"name\\"');
  expect(code).not.toContain('htmlFor=');
});

it('keeps model and send as ordinary props unless ViewBinding is explicitly imported', () => {
  const ordinary = compile(
    `const Child=view(p=><b>{p.model}</b>); view(p=><Child model={p.name} send={p.submit}/>);`,
  );
  expect(ordinary).toContain('"model":');
  expect(ordinary).toContain('"send":');
  const explicit = compile(
    `import {ViewBinding as Bind} from 'effectweb'; const Child=view((p,send)=><button onClick={()=>send(p)}>Go</button>); view((p,send)=><Bind view={Child} model={p} send={send}/>);`,
  );
  expect(explicit).toContain('.child(');
  expect(explicit).not.toContain('"view":');
  expect(
    compile(
      `const ViewBinding=view(p=><b>{p.model}</b>); view(p=><ViewBinding model={p.name} send={p.submit}/>);`,
    ),
  ).toContain('"model":');
});

it.each([
  `view(p=><Bind model={p} send={()=>{}}/>);`,
  `view(p=><Bind view={p.child} model={p} send={()=>{}}/>);`,
  `view(p=><Bind view={Child} model={p} send={()=>{}}>text</Bind>);`,
  `view(p=><Bind {...p}/>);`,
])('rejects ambiguous or dynamic explicit bindings: %s', (source) => {
  expect(() =>
    compile(`import {ViewBinding as Bind} from 'effectweb'; const Child=view(p=><b/>); ${source}`),
  ).toThrow(/ViewBinding/u);
});

it('lowers ordered component and intrinsic spreads with snapshot dependencies', () => {
  const code = compile(
    `const Child=view(p=><b>{p.text}</b>); view(p=><div><Child text="before" {...p.child} text="after"/><button {...p.attrs} title={p.title}>Click</button></div>);`,
  );
  expect(code).toContain('.bindAttributes(');
  expect(code).toContain('...(');
  expect(code).toContain('?.attrs');
  expect(code).toContain('?.child');
});

it('keeps direct spread event callbacks deferred and checks eager spread expressions', () => {
  expect(compile(`view(p=><button {...{onClick:()=>window.alert(p.label)}}/>);`)).toContain(
    '.bindAttributes(',
  );
  expect(
    compile(`view(p=><input {...{onInput:(event)=>{event.currentTarget.value='';}}}/>);`),
  ).toContain('.bindAttributes(');
  for (const expression of [
    `{onClick:(()=>window.alert('eager'))()}`,
    `{onClick:make(window.innerWidth)}`,
    `{style:{onClick:()=>window.alert('nested')}}`,
  ])
    expect(() => compile(`view(p=><button {...${expression}}/>);`)).toThrow(/Read window/u);
});

it.each([true, false])(
  'preserves public marker identity and scalar .ts authoring (development=%s)',
  (development) => {
    for (const source of ['effectweb', 'effectweb/dom']) {
      const result = compileSource(
        `import { view as render } from '${source}'; const alias=render; export const Label=alias<{label:string}>(model=>model.label);`,
        'label.ts',
        { development },
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain('.compiled(');
      expect(result.code).not.toContain('= alias(');
      expect(result.code).toContain('effectweb/dom');
    }
    const staticView = compileSource(
      `import {view} from 'effectweb'; export const Label=view(()=> <b>Static</b>);`,
      'static.tsx',
      { development },
    );
    expect(staticView.code).toContain('.compiled(');
    expect(staticView.diagnostics).toEqual([]);
    const namedPortal = compileSource(
      `import {view, Portal as Overlay} from 'effectweb'; const Portal=view(m=><b>{m.label}</b>); const Parent=view(m=><><Portal label={m.label}/><Overlay children={m.label}/></>);`,
      'portals.tsx',
      { development },
    );
    expect(namedPortal.diagnostics).toEqual([]);
    expect(namedPortal.code).not.toContain('.portal(');
    expect(namedPortal.code).toContain(', Portal,');
    expect(namedPortal.code).toContain(', Overlay,');
  },
);

it.each([true, false])(
  'rejects compiler markers escaping their owner (development=%s)',
  (development) => {
    for (const source of [
      "import * as EW from 'effectweb'; const A=EW.view(m=>m.text);",
      "import {view} from 'effectweb'; const escaped=[view];",
      "export {view as render} from 'effectweb';",
      "export * from 'effectweb';",
      "import * as EW from 'effectweb'; export const api=EW;",
      "import * as EW from 'effectweb'; const {view}=EW; const A=view(m=>m.text);",
      "import {view} from 'effectweb'; export const render=view;",
      "import * as EW from 'effectweb'; const alias=EW; const A=alias.view(m=>m.text);",
      "import {slot} from 'effectweb/dom'; const content=slot(()=> 'hello');",
      "import {view} from 'effectweb'; const A=view(m=> {const B=view(()=> 'inner'); return m.text;});",
    ]) {
      expect(() => compileSource(source, 'markers.ts', { development })).toThrow(/EW1001/u);
    }
  },
);

it.each(['effectweb', 'effectweb/effectEvent'])(
  'keeps recognized Effect event callbacks deferred in every attribute form: %s',
  (module) => {
    for (const attribute of [
      `onClick={request('replace', () => Effect.sync(() => records.push('clicked')))}`,
      `{...{ onClick: request('replace', () => Effect.sync(() => records.push('clicked'))) }}`,
    ]) {
      const source = `import {view} from 'effectweb'; import {effectEvent as request} from '${module}'; import {Effect} from 'effect'; const records=[]; view(model=><button ${attribute}/>);`;
      expect(compileSource(source, 'event-factory.tsx').code).toContain('.compiled(');
    }
  },
);
it.each([
  `onClick={(() => window.alert('eager'))()}`,
  `{...{onClick:(() => window.alert('eager'))()}}`,
  `onClick={make(() => window.alert('eager'))}`,
])('does not treat an arbitrary eager event factory as a deferred callback: %s', (attribute) => {
  expect(() => compile(`view(model=><button ${attribute}/>);`)).toThrow(/Read window/u);
});
