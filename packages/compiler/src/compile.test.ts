import { expect, it } from 'vitest';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { compile as compileSource, diagnose } from './compile';

type Markup = { tag: string; props: Record<string, unknown> };
const runtime = {
  view: (render: unknown) => render,
  slot: (render: unknown) => render,
  markup:
    (tag: string) =>
    (props: Record<string, unknown>): Markup => ({ tag, props }),
  renderComponent: (render: (props: unknown) => unknown, props: unknown) => render(props),
};
function execute(source: string, development = false): Record<string, unknown> {
  const result = compileSource(
    `import { view, slot } from 'effectweb';\n${source}`,
    'semantics.tsx',
    { development },
  );
  const js = ts.transpileModule(result.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  // Execute generated code against a value-only JSX host to inspect JavaScript evaluation.
  runInNewContext(js, { require: () => runtime, exports });
  return exports;
}
function content(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(content).join('');
  if (typeof value === 'object') return content((value as Markup).props.children);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  throw new Error('Unexpected presentation value');
}
const cases = [
  [
    'mutable locals and loops',
    `let total=0; for(const item of model.items){ if(item<0)continue; total+=item; if(total>4)break; } return <p>{total}</p>;`,
    '6',
  ],
  [
    'switch fallthrough and break',
    `let label='';switch(model.kind){case 'a':label+='a';case 'b':label+='b';break;default:label='other';}return <p>{label}</p>;`,
    'ab',
  ],
  ['switch with an empty label', `switch(model.kind){case 'a':} return <p>after</p>;`, 'after'],
  [
    'try catch and finally',
    `let label='';try {throw Error('value')}catch(error){label=error.message}finally{label+='!'}return <p>{label}</p>;`,
    'value!',
  ],
  [
    'forward closure captures',
    `const read=()=>caption;const caption=<b>{model.label}</b>;return <p>{read()}</p>;`,
    'one',
  ],
  [
    'finite recursive JSX',
    `const row=n=>n===0?null:<><b>{n}</b>{row(n-1)}</>;return row(3);`,
    '321',
  ],
  [
    'named functions and JSX arguments',
    `function wrap(child){return <section>{child}</section>};return wrap(<b>{model.label}</b>);`,
    'one',
  ],
  [
    'custom map with filtering and duplicated callback output',
    `const input={values:model.items,map(render){const result=render(this.values[1],7);return [result,result]}};return <p>{input.map((item,index)=><b>{item}:{index};</b>)}</p>;`,
    '2:7;2:7;',
  ],
  [
    'ordinary array callback arguments',
    `return <p>{model.items.map((item,index,array)=><b>{index}:{item}:{array.length};</b>)}</p>;`,
    '0:1:3;1:2:3;2:3:3;',
  ],
  [
    'extracted JSX callbacks',
    `const row=item=><b>{item}</b>;return <p>{model.items.map(row)}</p>;`,
    '123',
  ],
  ['Array.from callbacks', `return <p>{Array.from(model.items,item=><b>{item*2}</b>)}</p>;`, '246'],
  [
    'methods with a receiver',
    `const receiver={label:model.label,read(){return this.label}};return <p>{(receiver.read)()}</p>;`,
    'one',
  ],
  [
    'tagged methods with a receiver',
    'const receiver={label:model.label,tag(parts){return this.label+parts[0]}};return <p>{receiver.tag`!`}</p>;',
    'one!',
  ],
  [
    'optional calls',
    `const receiver={label:model.label,read(){return this.label}};return <p>{receiver?.read?.()}</p>;`,
    'one',
  ],
  [
    'nullish and logical expressions',
    `return model.hidden || <p>{model.missing ?? model.label}</p>;`,
    'one',
  ],
  ['comma expressions', `let value=0;return <p>{(value++,value+2)}</p>;`, '3'],
  [
    'rest and linked defaults',
    `const {a=[],b=a,...rest}=model.extra;return <p>{a===b?'linked':'different'}:{rest===rest?'same':'different'}</p>;`,
    'linked:same',
  ],
  [
    'JSX spreads in fragments',
    `const children=model.items.map(n=><b>{n}</b>);return <>{...children}</>;`,
    '123',
  ],
] as const;
for (const development of [true, false]) {
  it.each(cases)(
    'preserves ordinary JavaScript: %s (development=' + development + ')',
    (_name, body, expected) => {
      const exports = execute(`export const render=view(model=>{${body}});`, development);
      const render = exports.render as (model: object) => unknown;
      expect(content(render({ items: [1, 2, 3], kind: 'a', label: 'one', extra: {} }))).toBe(
        expected,
      );
    },
  );
}

it('evaluates JSX props and children once, in source order, including overridden props', () => {
  const exports = execute(`
    const calls=[];const read=(name,value)=>{calls.push(name);return value};
    const Panel=view(props=><p>{props.children}</p>);
    export const output=<Panel children={read('first',<i>A</i>)} {...read('spread',{children:<b>B</b>})}>{read('child',<b>C</b>)}</Panel>;
    export {calls};`);
  expect(exports.calls).toEqual(['first', 'spread', 'child']);
  expect(content(exports.output)).toBe('C');
});
it('preserves each render frame and each event closure without caching rest objects', () => {
  const { render } = execute(
    `export const render=view(model=>{const {...rest}=model;return <button data-value={rest} onClick={()=>rest}/>});`,
  ) as { render: (model: object) => Markup };
  const model = { label: 'one' };
  const first = render(model),
    second = render(model);
  expect(first.props['data-value']).not.toBe(second.props['data-value']);
  expect((first.props.onClick as () => unknown)()).toBe(first.props['data-value']);
  expect((second.props.onClick as () => unknown)()).toBe(second.props['data-value']);
});
it('passes __proto__ as an own JSX prop without changing the props prototype', () => {
  const { output } = execute(`
    const Panel=view(props=>({own:Object.hasOwn(props,'__proto__'),value:props.__proto__,inherited:props.injected}));
    export const output=<Panel __proto__={{injected:true}}/>;`);
  expect(output).toEqual({ own: true, value: { injected: true }, inherited: undefined });
});
it('supports namespace components, ordinary slot callbacks and higher-order view factories', () => {
  const { render } = execute(`import * as EW from 'effectweb';
    const make=factory=>factory;const define=make(EW.view);const row=slot(({label})=><b>{label}</b>);
    const ui={Panel:define(props=><section>{props.children}</section>)};
    export const render=define(model=><ui.Panel>{row(model)}</ui.Panel>);`) as {
    render: (model: object) => unknown;
  };
  expect(content(render({ label: 'ordinary' }))).toBe('ordinary');
});
it('preserves normal early completion and uncaught exceptions', () => {
  const { render } = execute(
    `export const render=view(model=>{if(model.hidden)return;if(model.bad)throw Error('render failed');return <b>ok</b>});`,
  ) as { render: (model: object) => unknown };
  expect(render({ hidden: true })).toBeUndefined();
  expect(() => render({ bad: true })).toThrow('render failed');
  expect(content(render({}))).toBe('ok');
});
it('decodes JSX entities once while preserving expression strings and whitespace', () => {
  const { output } = execute(`export const output=<p title="&amp;lt;">&amp;lt;{'&lt;'}
    <b> spaced </b>
    after
  </p>;`) as { output: Markup };
  expect(output.props.title).toBe('&lt;');
  expect(content(output)).toBe('&lt;&lt; spaced after');
});
it('treats hyphenated JSX names as intrinsic tags regardless of their first letter', () => {
  const { output } = execute(`const X=7,widget=4;export const output=<X-widget title="value"/>;`);
  expect(output).toEqual({ tag: 'X-widget', props: { title: 'value' } });
});
it.each(['key', 'ref', 'innerHTML'])(
  'reports unsupported intrinsic syntax %s at its source location',
  (name) => {
    const source = `import {view} from 'effectweb';\nconst App=view(model=><p ${name}={model.value}/>);`;
    expect(() => compileSource(source, 'syntax.tsx')).toThrow(`attribute ${name}`);
    expect(diagnose(source, 'syntax.tsx')).toEqual([
      expect.objectContaining({ line: 2, code: 'EW1001' }),
    ]);
  },
);
it('collects independent syntax errors and accepts member components', () => {
  const source = `import {view} from 'effectweb';const A=view(m=><div key={m.id}/>);const B=view(m=><ui.Button ref={m.ref}/>);const C=view(m=><b innerHTML={m.html}/>);`;
  expect(diagnose(source, 'syntax.tsx')).toHaveLength(2);
});
it.each(['\r', '\r\n', '\u2028', '\u2029'])(
  'reports JSX diagnostics after JavaScript line separator %j',
  (separator) => {
    const source = `import {view} from 'effectweb';${separator}const A=view(()=><p key="x"/>);`;
    expect(diagnose(source, 'lines.tsx')).toEqual([
      expect.objectContaining({ line: 2, column: 21 }),
    ]);
  },
);
it('resolves an explicitly configured runtime and leaves unrelated modules alone', () => {
  const source = `import {view} from '@example/ui';export const App=view(model=><b>{model.label}</b>);`;
  expect(compileSource(source, 'app.tsx').code).toBe(source);
  const result = compileSource(source, 'app.tsx', {
    importSource: '@example/ui',
    runtimeModule: 'runtime/dom',
  });
  expect(result.code).toContain('runtime/dom');
  expect(result.code).toContain('.markup(');
  expect(result.code).not.toContain('.compiled(');
});
it('honors the explicit module JSX source for helper files and foreign framework islands', () => {
  const helper = `/** @jsxImportSource effectweb */ export const row=value=><b>{value}</b>;`;
  expect(compileSource(helper, 'helper.tsx').code).not.toContain('<b>');
  const foreign = `/** @jsxImportSource solid-js */ import {mountView} from 'effectweb';export const App=()=> <p ref={node=>node.focus()}/>;`;
  expect(compileSource(foreign, 'foreign.tsx').code).toBe(foreign);
});
it.each([
  "import * as EW from 'effectweb'; const A=EW.view(m=>m.text);",
  "import {view} from 'effectweb'; const escaped=[view]; export {escaped};",
  "export {view as render} from 'effectweb';",
  "export * from 'effectweb';",
  "import {slot} from 'effectweb'; export const content=slot(()=> 'hello');",
])('preserves ordinary public functions and exports: %s', (source) => {
  expect(compileSource(source, 'ordinary.ts').code).toBe(source);
});
it('adds source metadata for evaluated JSX values only in development', () => {
  const source = `import {view} from 'effectweb';const App=view(model=><p title={model.title}>{format(model)}</p>);`;
  const dev = compileSource(source, 'app.tsx', { development: true });
  const prod = compileSource(source, 'app.tsx', { development: false });
  expect(dev.code).toContain('"dependencies": ["format(model)"]');
  expect(prod.code).not.toContain('dependencies');
  expect(diagnose(source, 'app.tsx')).toEqual([]);
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
