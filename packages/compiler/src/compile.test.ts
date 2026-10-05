import { expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { compile as compileSource, diagnose } from './compile';

type Markup = { tag: string; props: Record<string, unknown> };
type Shape = [string, Record<string, unknown> | null | 0, unknown[]];
const runtime = {
  view: (render: unknown) => render,
  slot: (render: unknown) => render,
  markup:
    (tag: string) =>
    (attrs: Record<string, unknown> | null, ...children: unknown[]): Markup => ({
      tag,
      props: {
        ...attrs,
        ...(children.length ? { children: children.length > 1 ? children : children[0] } : {}),
      },
    }),
  still: (content: unknown) => content,
  // A block passes only the values of its dynamic positions; rebuild the element tree.
  block:
    (site: Shape) =>
    (...values: unknown[]): Markup => {
      let cursor = 0;
      const build = ([tag, attrs, children]: Shape): Markup => {
        const applied = attrs === 0 ? (values[cursor++] as Record<string, unknown>) : attrs;
        const items = children.map((child) =>
          child === 1 ? values[cursor++] : Array.isArray(child) ? build(child as Shape) : child,
        );
        return {
          tag,
          props: {
            ...applied,
            ...(items.length ? { children: items.length > 1 ? items : items[0] } : {}),
          },
        };
      };
      return build(site);
    },
};
function execute(source: string, development = false): Record<string, unknown> {
  const result = compileSource(
    `import { view, slot } from 'effectweb';\n${source}`,
    'semantics.tsx',
    { development },
  );
  const js = transformSync(result.code, { target: 'es2022', format: 'cjs', loader: 'ts' }).code;
  const exports = {};
  // Execute generated code against a value-only JSX host to inspect JavaScript evaluation.
  const module = { exports };
  runInNewContext(js, { require: () => runtime, exports, module });
  return module.exports;
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
it('resolves an explicitly configured runtime and compiles JSX from any module', () => {
  const source = `import {view} from '@example/ui';export const App=view(model=><b>{model.label}</b>);`;
  expect(compileSource(source, 'app.tsx').code).toContain('effectweb/dom');
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
  const foreign = `/** @jsxImportSource solid-js */ import {mount} from 'effectweb';export const App=()=> <p ref={node=>node.focus()}/>;`;
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
  expect(dev.code).toContain('"expression": "format(model)"');
  expect(prod.code).not.toContain('"expression"');
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

// JSX text, whitespace and entity handling must agree with the standard automatic transform.
const reference = (source: string) => {
  const js = transformSync(source, {
    loader: 'tsx',
    format: 'cjs',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'reference',
  }).code;
  const stub = {
    jsx: (tag: unknown, props: Record<string, unknown>) => ({ tag, props }),
    jsxs: (tag: unknown, props: Record<string, unknown>) => ({ tag, props }),
    Fragment: 'fragment',
  };
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(js, { require: () => stub, exports: module.exports, module });
  return module.exports;
};
it.each([
  ['line breaks and indentation', `<p>\n  Hello  <b>world</b>\n  {m.x}\n  tail\n</p>`],
  ['interior spaces', `<p> a <b> b </b>  c  </p>`],
  ['explicit space expressions', `<p>a{' '}<b>b</b>{' '}c</p>`],
  [
    'entities in text and attributes',
    `<p title="&quot;&amp;&lt;">&nbsp;&copy;&#169;&#xA9;&amp;lt;{'&lt;'}</p>`,
  ],
  ['blank lines and trailing spaces', `<p>\n\n  first   \n\n  second\n\n</p>`],
  ['text around nested elements', `<ul>\n  <li>one</li> two\n  <li>three</li>\n</ul>`],
  ['numbers and booleans as children', `<p>{0}{false}{null}{'x'}{1.5}</p>`],
])('agrees with the automatic JSX transform on %s', (_name, markup) => {
  const exports = execute(`export const render=view(m=>${markup});`);
  const expected = reference(`export const render = (m) => ${markup};`) as {
    render: (m: object) => unknown;
  };
  const render = exports.render as (m: object) => unknown;
  const input = { x: 'X' };
  expect(content(render(input))).toBe(content(expected.render(input)));
  const title = (value: unknown) => (value as Markup).props.title;
  expect(title(render(input))).toBe(title(expected.render(input)));
});

it('records the static shape of nested intrinsic elements for the renderer to clone', () => {
  const source = `import {view} from 'effectweb';
export const Row = view(m => <tr class={m.c}><td class="id">{m.id}</td><td><a onClick={m.pick}>{m.label}</a></td><td><input value={m.v} /></td></tr>);
export const Wrapper = view(m => <section {...m.attrs}><Child /><p>{...m.parts}</p></section>);`;
  const code = compileSource(source, 'shape.tsx').code.replace(/\s+/gu, '');
  // Dynamic attributes are 0, baked literal attributes are the hoisted object, dynamic children are 1.
  expect(code).toMatch(/=\["tr",0,\[\["td",_ew_a\d+,\[1\]\],_ew_k\d+,_ew_k\d+\]\];/u);
  // A literal value attribute is a control binding, so the input's attributes stay dynamic.
  expect(code).toMatch(/=\["td",null,\[\["input",0,\[\]\]\]\];/u);
  expect(code).toMatch(/=\["td",null,\[\["a",0,\[1\]\]\]\];/u);
  // The row is one call carrying only its dynamic values, in source order.
  expect(code).toMatch(/=\/\*@__PURE__\*\/_ew_dom\.block\(_ew_k\d+\);/u);
  expect(code).toMatch(
    /view\(\(m\)=>_ew_jsx\d+\(\{"class":m\.c\},m\.id,\{"onClick":m\.pick\},m\.label,\{"value":m\.v\}\)\)/u,
  );
  // Spread attributes may supply children; components and spread children are dynamic positions.
  expect(code).toMatch(/=\["section",0,\[1,\["p",null,\[1\]\]\]\];/u);
});

it('keeps elements the renderer cannot clone out of the cloned shape', () => {
  const source = `import {view} from 'effectweb';
export const Form = view(m => <form><input type="text" name="q" /><video autoplay src="a.mp4">{m.fallback}</video><b>{m.label}</b></form>);`;
  const code = compileSource(source, 'unclonable.tsx').code.replace(/\s+/gu, '');
  // A literal input is a position of its own; a media element's attributes are applied per clone.
  expect(code).toMatch(/=\["form",null,\[1,\["video",0,\[1\]\],\["b",null,\[1\]\]\]\];/u);
});

it('appends the values an inline list callback captures', () => {
  const source = `import {list, view} from 'effectweb';
let total = 0;
export const bump = () => { total++; };
const Constant = 1;
export const Rows = view((model, send) => {
  const { selected } = model;
  let moving = 0;
  moving++;
  return <ul>
    {list(model.rows, (row) => <li class={row.id === selected ? 'on' : ''} onClick={() => send(row.id)}>{model.labels.short}{model.labels.short.length}{model.rows.filter(Boolean).length}{Constant}{total}</li>)}
    {list(model.rows, (row) => row.id, (row) => <li>{row.name}</li>)}
    {list(model.rows, (row) => <li>{moving}</li>)}
    {list(model.rows, Row)}
  </ul>;
});`;
  const code = compileSource(source, 'captures.tsx').code.replace(/\s+/gu, '');
  // Outer values are listed once; a longer path under a listed one adds nothing; a called
  // member depends on its receiver; reassigned module state is compared by value.
  expect(code).toContain(',[_ew_c0,selected,send,model?.labels?.short,model?.rows,total],false)');
  expect(code).toContain('(row)=>row.id,(row)=>_ew_jsx');
  expect(code).toMatch(/row\.name\),\[_ew_c1\],false\)/u);
  // A reassigned local and a callback declared elsewhere are left to identity comparison.
  expect(code).toMatch(/moving\)\),list/u);
  expect(code).toContain('list(model.rows,Row)');
});

const captured = (body: string) =>
  compileSource(`import { list, view } from 'effectweb';\n${body}`, 'captures.tsx').code.replace(
    /\s+/gu,
    '',
  );
it.each([
  [
    'an outer row is a captured value of a nested list',
    `view((model) => <ul>{list(model.groups, (g) => g.id, (g) => <li>{list(g.items, (it) => <b>{g.name}{it}{model.sep}</b>)}</li>)}</ul>);`,
    ['[_ew_c0,g?.name,model?.sep],false', ',[_ew_c1,model?.sep],false'],
  ],
  [
    'a callback parameter shadows an outer binding of the same name',
    `view((model) => { const x = model.a; return <ul>{list(model.rows, (x) => <li>{x}{model.b}</li>)}</ul>; });`,
    [',[_ew_c0,model?.b],false)'],
  ],
  [
    'destructured and rest parameters are captured by name',
    `view(({ rows, labels: { short }, ...rest }) => <ul>{list(rows, (r) => <li>{short}{rest.z}</li>)}</ul>);`,
    [',[_ew_c0,short,rest?.z],false)'],
  ],
  [
    'an optional or asserted call depends on its receiver',
    `view((model) => <ul>{list(model.rows, (r) => <li>{model.fmt?.(r)}{model.a?.b.c}{model.x!.y}</li>)}</ul>);`,
    [',[_ew_c0,model],false)'],
  ],
  [
    'a computed member depends on the object it indexes',
    `view((model) => <ul>{list(model.rows, (r) => <li>{model.byId[r.id].name}</li>)}</ul>);`,
    [',[_ew_c0,model?.byId],false)'],
  ],
  [
    'types are not values',
    `view((model) => { type L = string; return <ul>{list(model.rows, (r) => <li>{r as L}</li>)}</ul>; });`,
    ['rasL),[_ew_c0],false)'],
  ],
  [
    'a component read from a local object captures that object',
    `view((model) => { const ui = model.ui; return <ul>{list(model.rows, (r) => <ui.Row r={r} />)}</ul>; });`,
    [',[_ew_c0,ui],false)'],
  ],
  [
    'a helper declared in the view is captured as a value',
    `view((model) => { function label(r) { return model.names[r]; } return <ul>{list(model.rows, (r) => <li>{label(r)}</li>)}</ul>; });`,
    [',[_ew_c0,label],false)'],
  ],
  [
    'loop and catch bindings are captured like any local',
    `view((model) => { try { f(); } catch (e) { for (const g of model.groups) return list(g.rows, (r) => <li>{g.name}{e.message}</li>); } });`,
    [',[_ew_c0,g?.name,e?.message],false)'],
  ],
  [
    'a parameter default reads outer values too',
    `view((model) => <ul>{list(model.rows, (r, i = model.start) => <li>{i}</li>)}</ul>);`,
    [',[_ew_c0,model?.start],true)'],
  ],
  [
    'spread attributes and handler closures are read like any expression',
    `view((model, send) => <ul>{list(model.rows, (r) => <li {...model.attrs} onClick={() => send(r)} />)}</ul>);`,
    [',[_ew_c0,model?.attrs,send],false)'],
  ],
  [
    'a tagged template depends on the receiver of its tag',
    'view((model) => <ul>{list(model.rows, (r) => <li>{`${model.a.b}-${r}`}{model.t.tag`x`}</li>)}</ul>);',
    [',[_ew_c0,model?.a?.b,model?.t],false)'],
  ],
])('list captures: %s', (_name, body, expected) => {
  const code = captured(body);
  for (const fragment of expected) expect(code).toContain(fragment);
});

it.each([
  [
    'a parenthesized callback',
    `view((model) => <ul>{list(model.rows, ((r) => <li>{model.a}</li>))}</ul>);`,
  ],
  [
    'a callback containing this',
    `view((model) => <ul>{list(model.rows, (r) => <li onClick={function () { return this; }}>{model.a}</li>)}</ul>);`,
  ],
  [
    'a binding declared after the call',
    `view((model) => { const rows = list(model.rows, (r) => <li>{later}</li>); const later = model.a; return rows; });`,
  ],
  [
    'a reassigned local',
    `view((model) => { let n = 0; n = model.a; return <ul>{list(model.rows, (r) => <li>{n}</li>)}</ul>; });`,
  ],
  ['a callback declared elsewhere', `view((model) => <ul>{list(model.rows, Row)}</ul>);`],
  [
    'a list that is not the runtime export',
    `const list = (rows, render) => rows.map(render); view((model) => <ul>{list(model.rows, (r) => <li>{model.a}</li>)}</ul>);`,
  ],
])('list captures are left to identity comparison for %s', (name, body) => {
  const source = name.startsWith('a list that is not')
    ? `import { view } from 'effectweb';\n${body}`
    : `import { list, view } from 'effectweb';\n${body}`;
  const code = compileSource(source, 'uncaptured.tsx').code.replace(/\s+/gu, '');
  // No array of captured values follows the callback.
  expect(code).not.toMatch(/,\[[\w?.,]*\]\)/u);
});

it('appends captures for an aliased import of list', () => {
  const code = compileSource(
    `import { list as each, view } from 'effectweb';\nview((model) => <ul>{each(model.rows, (r) => <li>{model.a}</li>)}</ul>);`,
    'alias.tsx',
  ).code.replace(/\s+/gu, '');
  expect(code).toContain(',[_ew_c0,model?.a],false)');
});

it.each([
  [
    'a function prop of a view records its site and the values it reads',
    `const Row = view(p => <li/>); export const L = view((m, send) => <Row id={m.id} onPick={(id) => send({ id, list: m.list })} />);`,
    /"onPick":_ew_dom\.captured\(\(id\)=>send\(\{id,list:m\.list\}\),\[_ew_c0,send,m\?\.list\]\)/u,
  ],
  [
    'a called member captures its receiver',
    `const Row = view(p => <li/>); export const L = view((m) => <Row onPick={() => m.actions.pick(m.row.id)} />);`,
    /\[_ew_c0,m\?\.actions,m\?\.row\?\.id\]/u,
  ],
  [
    'each site has its own identity',
    `const Row = view(p => <li/>); export const L = view((m) => <><Row onPick={() => m.a} /><Row onPick={() => m.a} /></>);`,
    /const_ew_c0=Symbol\(\);const_ew_c1=Symbol\(\);.*\[_ew_c0,m\?\.a\].*\[_ew_c1,m\?\.a\]/u,
  ],
])('function props: %s', (_name, body, expected) => {
  expect(captured(body)).toMatch(expected);
});

it.each([
  [
    'a handler on an element',
    `export const L = view((m) => <button onClick={() => m.pick(m.id)} />);`,
  ],
  [
    'an async function',
    `const Row = view(p => <li/>); export const L = view((m) => <Row onPick={async () => m.id} />);`,
  ],
  [
    'a function reading a reassigned local',
    `const Row = view(p => <li/>); export const L = view((m) => { let n = 0; n = m.n; return <Row onPick={() => n} />; });`,
  ],
  [
    'a function that is not written inline',
    `const Row = view(p => <li/>); export const L = view((m) => <Row onPick={m.pick} />);`,
  ],
])('function props left alone: %s', (_name, body) => {
  expect(captured(body)).not.toContain('.captured(');
});
