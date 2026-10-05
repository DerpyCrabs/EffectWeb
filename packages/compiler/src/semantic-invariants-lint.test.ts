import { describe, expect, it } from 'vitest';
import { compile, lint } from './compile';

const checkRender = (source: string, filename: string) => {
  const errors = lint(source, filename).filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(errors.map((issue) => issue.message).join('\n'));
  return compile(source, filename);
};

const views = (prefix: string, expression: string) =>
  `import {view} from 'effectweb'; ${prefix} const App=view(m=><p>{${expression}}</p>);`;
const helpers = [
  ['direct', (body: string) => `const read=()=>${body};`, 'read()'],
  ['alias', (body: string) => `const original=()=>${body};const read=original;`, 'read()'],
  ['object', (body: string) => `const helpers={read:()=>${body}};`, 'helpers.read()'],
  ['spread', (body: string) => `const helpers={read:()=>${body},...{}};`, 'helpers.read()'],
  [
    'rest',
    (body: string) => `const helpers={read:()=>${body}};const {...rest}=helpers;`,
    'rest.read()',
  ],
  [
    'computed',
    (body: string) => `const key='read';const helpers={[key]:()=>${body}};`,
    'helpers.read()',
  ],
  ['factory', (body: string) => `const make=()=>()=>${body};const read=make();`, 'read()'],
  [
    'receiver',
    (body: string) => `const helpers={get label(){return ${body}},read(){return this.label}};`,
    'helpers.read()',
  ],
  [
    'higher order',
    (body: string) => `const read=()=>${body};const invoke=fn=>fn();`,
    'invoke(read)',
  ],
] as const;

for (const [name, declare, expression] of helpers) {
  describe(name, () => {
    it('rejects hidden mutable captures independent of the helper representation', () => {
      const source = views(`let ambient='old';${declare('ambient')}`, expression);
      expect(() => checkRender(source, 'capture.tsx')).toThrow(
        /Mutable capture|unprovable|cannot prove/iu,
      );
      expect(lint(source, 'capture.tsx')).toEqual([expect.objectContaining({ severity: 'error' })]);
    });
    it('accepts the corresponding pure helper', () => {
      expect(lint(views(declare("'fixed'"), expression), 'pure.tsx')).toEqual([]);
    });
  });
}

it.each([
  `const values=m.items.map(read);return <p>{values.join(',')}</p>;`,
  `return <p>{m.items.map(read).join(',')}</p>;`,
  `const values=Array.from(m.items,read);return <p>{values.join(',')}</p>;`,
  `const invoke=fn=>fn();return <p>{invoke(read)}</p>;`,
])('checks eager callbacks independently of chaining and temporary variables: %s', (body) => {
  const source = `import {view} from 'effectweb'; let ambient='old';const read=()=>ambient;const App=view(m=>{${body}});`;
  expect(() => checkRender(source, 'callbacks.tsx')).toThrow(
    /Mutable capture|unprovable|cannot prove/iu,
  );
});

it.each([
  `const helpers={read:()=> 'fixed'};helpers.read=()=>ambient;`,
  `const helpers={read:()=> 'fixed'};const alias=helpers;alias.read=()=>ambient;`,
])('invalidates provenance when an object can be modified: %s', (declarations) => {
  expect(() =>
    checkRender(views(`let ambient='old';${declarations}`, 'helpers.read()'), 'writes.tsx'),
  ).toThrow();
});

it.each([
  `const helpers={slice:input=>input};const read=input=>{const result=helpers.slice(input);result.push(1);return result.length};`,
  `const read=input=>{let result=[];result=input;result.push(1);return result.length};`,
  `const read=input=>{const copy={input};copy.input.push(1);return 1};`,
  `const read=input=>Array.prototype.sort.call(input);`,
])(
  'requires ownership evidence at the mutation, including aliases and indirect calls: %s',
  (prefix) => {
    expect(() => checkRender(views(prefix, 'read(m.items)'), 'ownership.tsx')).toThrow(
      /mutat|borrowed/u,
    );
  },
);

for (const callback of [
  `()=>m.items.push(1)`,
  `()=>m.map.set('key',2)`,
  `()=>m.set.add(2)`,
  `()=>Object.assign(m,{value:2})`,
  `()=>Reflect.set(m,'value',2)`,
  `function(){m.map.set('key',2)}`,
]) {
  for (const attribute of [`onClick={${callback}}`, `{...{onClick:${callback}}}`]) {
    it(`keeps borrowed data immutable in events: ${attribute}`, () => {
      expect(() =>
        checkRender(
          views('', `null`).replace('<p>{null}</p>', `<button ${attribute}/>`),
          'events.tsx',
        ),
      ).toThrow(/mutat|borrowed/u);
    });
  }
}

for (const callback of [`()=>window.alert('hello')`, `function(){window.alert('hello')}`]) {
  it(`recognizes deferred execution independently of function syntax: ${callback}`, () => {
    const source = `import {view} from 'effectweb';view(m=><button onClick={${callback}}/>);`;
    expect(lint(source, 'event-syntax.tsx')).toEqual([]);
  });
}

it('treats callback fields passed to a child as deferred and still forbids snapshot writes', () => {
  const source = `import {view} from 'effectweb';import {Child} from './child';view(m=><Child actions={{nested:{run:()=>window.alert(m.label)}}}/>);`;
  expect(lint(source, 'callback-fields.tsx')).toEqual([]);
  expect(() =>
    checkRender(source.replace('window.alert(m.label)', 'm.items.push(1)'), 'callback-fields.tsx'),
  ).toThrow(/borrowed|mutat/u);
});

it.each([true, false])(
  'accepts private mutation inside and outside a view (inside=%s)',
  (inside) => {
    const helper = `const read=input=>{const result=[];result.push(input);return result.length};`;
    const source = inside
      ? `import {view} from 'effectweb';view(m=>{${helper}return <p>{read(m.value)}</p>});`
      : views(helper, 'read(m.value)');
    expect(lint(source, 'local.tsx')).toEqual([]);
  },
);

it('treats view-body allocations as owned while rendering, but not in later callbacks', () => {
  // Views re-execute on every publication, so a view-body allocation is fresh per render.
  for (const body of [
    `const items=[];return <p>{append(items,m.value)}</p>`,
    `const items=[1];items.push(m.value);return <p>{items.length}</p>`,
    `const rows:number[]=[];if(m.value)rows.push(m.value);return <p>{rows.length}</p>`,
    `const date=new Date(m.value,0,1);date.setDate(2);return <p>{date.getTime()}</p>`,
  ])
    expect(() =>
      checkRender(
        `import {view} from 'effectweb';
    const append=(items,value)=>{items.push(value);return items.length};
    view(m=>{${body}});`,
        'render-allocation.tsx',
      ),
    ).not.toThrow();
  const later = `import {view} from 'effectweb';
    view(m=>{const items=[];return <button onClick={()=>{items.push(m.value)}}>{items.length}</button>});`;
  expect(() => checkRender(later, 'callback-allocation.tsx')).toThrow(/mutat|borrowed/u);
});

it.each([
  `const a=[];a.slice=()=>Math.random();return a.slice()`,
  `const a=[];const alias=a;alias['slice']=()=>Math.random();return a.slice()`,
  `const a={read:()=>0};a.read=fn;return a.read()`,
  `const a=[];Object.assign(a,{slice:fn});return a.slice()`,
  `const a={read:()=>0};Object.assign(a,{read:fn});return a.read()`,
  `const a=[];Object.defineProperty(a,'slice',{value:fn});return a.slice()`,
])('does not retain callable provenance after reconfiguring a private object: %s', (body) => {
  const source = views(`const read=fn=>{${body}};`, 'read(m.fn)');
  expect(() => checkRender(source, 'reconfigured.tsx')).toThrow();
});

it.each([
  [`import {format} from './format';`, 'format(m.value)'],
  [`import {format as label} from './renamed/helper';`, 'label(m.value)'],
  [`import format from './format';`, 'format(m.value)'],
  [`import * as format from './format';`, 'format.label(m.value)'],
  [`import {formatters} from './format';`, 'formatters.label(m.value)'],
  [`import {format} from 'format-library';`, 'format(m.value)'],
])('accepts ordinary imported helpers without registration: %s', (imports, expression) => {
  const source = `import {view} from 'effectweb';${imports}view(m=><p>{${expression}}</p>);`;
  expect(lint(source, 'imports.tsx')).toEqual([]);
  expect(checkRender(source, 'imports.tsx').code).toContain('markup');
});

it('does not infer ownership from an imported helper result', () => {
  const source = `import {view} from 'effectweb';import {copy} from './helpers';view(m=>{const items=copy(m.items);items.push(1);return <p>{items.length}</p>});`;
  expect(() => checkRender(source, 'imports.tsx')).toThrow(/borrowed|mutat/u);
});

it('allows immutable setup data to be passed to an imported helper', () => {
  const source = `import {view} from 'effectweb';import {format} from './helpers';const options={prefix:'Name'};view(m=><p>{format(options,m.name)}</p>);`;
  expect(lint(source, 'imports.tsx')).toEqual([]);
});

it.each([
  `import Icon from './icon';view(m=><Icon label={m.label}/>);`,
  `const helpers={read:input=>input.label};view(m=><p>{helpers.read(m)}</p>);`,
  `const forms={phone:{label:'Phone'}};view(m=>{const form=forms[m.step];return <input value={form.label} onInput={()=>m.change(form.label)}/>});`,
  `const options={label:'fixed'};const helpers={read:m=>{window.alert(m);return m}};view(m=><button onClick={()=>helpers.read(options.label)}>{options.label}</button>);`,
  `const rows=collection(item=>item.id);view(m=><p>{rows.from(m.items).filter(item=>item.visible).length}</p>);`,
  `const read=value=>new Date(value).toLocaleTimeString();view(m=><p>{read(m.time)}</p>);`,
])('retains provenance without treating unrelated execution as mutation: %s', (body) => {
  expect(
    lint(`import {view,collection} from 'effectweb';${body}`, 'provenance.tsx').filter(
      (issue) => issue.severity === 'error',
    ),
  ).toEqual([]);
});

it.each([
  `let ambient='old';class Box{get value(){return ambient}}const box=new Box();view(m=><p>{box.value}</p>);`,
  `let ambient='old';const tag=()=>ambient;view(m=><p>{tag\`value\`}</p>);`,
  `view(m=><p>{import('./module')}</p>);`,
  `import {MutableRef} from 'effect';view(m=><p>{MutableRef.set(m.ref,2)}</p>);`,
  `import {Effect} from 'effect';const run=Effect.runSync;view(m=><p>{run(m.effect)}</p>);`,
  `import {DateTime} from 'effect';view(m=><p>{DateTime.nowUnsafe()}</p>);`,
  `import {mount} from 'effectweb';view(m=><p>{mount(m.element,m.view,m.source)}</p>);`,
  `const visit=(items,borrowed,again)=>{if(again)visit(borrowed,borrowed,false);items.push(1)};view(m=><p>{visit([],m.items,true)}</p>);`,
])('requires evidence for every execution form and library effect: %s', (body) => {
  expect(() => checkRender(`import {view} from 'effectweb';${body}`, 'effects.tsx')).toThrow();
});

it.each([
  `view(({value=Math.random()})=><p>{value}</p>);`,
  `view(({[Math.random()]:value})=><p>{value}</p>);`,
  `const read=(value=Math.random())=>value;view(m=><p>{read(m.value)}</p>);`,
  `const read=({value=Math.random()})=>value;view(m=><p>{read(m.data)}</p>);`,
  `const read=({[Math.random()]:value})=>value;view(m=><p>{read(m.data)}</p>);`,
])('checks effects executed while binding parameters: %s', (body) => {
  expect(() =>
    checkRender(`import {view} from 'effectweb';${body}`, 'parameter-effects.tsx'),
  ).toThrow(/randomness/u);
});

it('reads optional member calls as callbacks rather than collection mutations', () => {
  const source = `import {view} from 'effectweb';
    view(m=><button onClick={()=>{m.props.add?.();m.props.clear?.(m.id)}}>{m.label}</button>);`;
  expect(() => checkRender(source, 'optional-callback.tsx')).not.toThrow();
  const required = `import {view} from 'effectweb';
    view(m=><button onClick={()=>{m.tags.add(m.id)}}>{m.label}</button>);`;
  expect(() => checkRender(required, 'set-mutation.tsx')).toThrow(/onAdd/u);
});

it('owns containers allocated by Object and Array constructors in callbacks', () => {
  const source = `import {view} from 'effectweb';
    view(m=><button onClick={()=>{const d=Object.fromEntries(m.pairs);d.extra=1;const k=Object.keys(m.record);k.push('x');m.save(d,k)}}>{m.label}</button>);`;
  expect(() => checkRender(source, 'fresh-containers.tsx')).not.toThrow();
  const nested = `import {view} from 'effectweb';
    view(m=><button onClick={()=>{const d=Object.fromEntries(m.pairs);d.first.count=1}}>{m.label}</button>);`;
  expect(() => checkRender(nested, 'borrowed-elements.tsx')).toThrow(/borrowed|mutat/u);
});

it('accepts observe on a controller source while still checking its render callback', () => {
  const accepted = `import {view, observe, modelOwner} from 'effectweb';
    export function make(){const owner=modelOwner({label:''});
      return view(()=>observe(owner.source,(s)=><button onClick={()=>owner.patch({label:'x'})}>{s.label}</button>));}`;
  expect(() => checkRender(accepted, 'observe-owner.tsx')).not.toThrow();
  const impure = `import {view, observe, modelOwner} from 'effectweb';
    export function make(){const owner=modelOwner({label:''});
      return view(()=>observe(owner.source,(s)=><p>{s.label}{Math.random()}</p>));}`;
  expect(() => checkRender(impure, 'observe-impure.tsx')).toThrow(/random/u);
});

it.each([
  [
    `import {view, list, entities} from 'effectweb'; view(m=><ul>{list(entities(m.rows),(r)=><li>{Math.random()}</li>)}</ul>);`,
    /random/u,
  ],
  [`import {slot} from 'effectweb'; export const S=slot((v)=><b>{Date.now()}</b>);`, /Date/u],
])('checks list and slot render callbacks as render code: %s', (source, error) => {
  expect(() => checkRender(source, 'render-callbacks.tsx')).toThrow(error);
});

it('treats framework view factories as compiled views', () => {
  const source = `import {view} from 'effectweb'; import {memoView} from 'effectweb/advanced';
    const Card=memoView(view(p=><b>{p.t.id}</b>),(a,b)=>a.t===b.t);
    view(m=><div><Card t={m.item} /></div>);`;
  expect(() => checkRender(source, 'memo-view.tsx')).not.toThrow();
});

it('proves factory parameters read by views unless something writes to them', () => {
  const ok = `import {view} from 'effectweb'; export function make(cfg){return view(()=><p>{cfg.title}</p>);}`;
  expect(() => checkRender(ok, 'factory-param.tsx')).not.toThrow();
  const written = `import {view} from 'effectweb'; export function make(cfg){const V=view(()=><p>{cfg.items.length}</p>);cfg.items.push('x');return V;}`;
  expect(() => checkRender(written, 'factory-param-written.tsx')).toThrow(/mutate/u);
});

it('accepts pure recursive helpers', () => {
  const source = `import {view} from 'effectweb';
    const contains=(item,path)=>item.path===path||!!item.children?.some((child)=>contains(child,path));
    view(m=><p>{contains(m.tree,m.path)?'yes':'no'}</p>);`;
  expect(() => checkRender(source, 'recursive.tsx')).not.toThrow();
});

it('treats values resolved by setup before creating a view as captured data', () => {
  const source = `import {view} from 'effectweb'; import {Effect} from 'effect';
    export const app=Effect.gen(function*(){const account=yield* session;return view(()=><p>{account.name}</p>);});`;
  expect(() => checkRender(source, 'setup-yield.tsx')).not.toThrow();
  const inRender = `import {view} from 'effectweb';
    export const V=view(async (m)=>{const value=await m.load();return <p>{value}</p>;});`;
  expect(() => checkRender(inRender, 'render-await.tsx')).toThrow();
});

it.each([
  "(m.items.push('x'), m.source)",
  "(() => { m.items.push('x'); return m.source; })()",
  'm.sources[Math.random()]',
])('checks work used to evaluate an observed source: %s', (source) => {
  expect(() =>
    checkRender(
      `import {view,observe} from 'effectweb';view(m=>observe(${source},s=><p>{s}</p>));`,
      'observe-source-effects.tsx',
    ),
  ).toThrow(/mutat|borrowed|random/u);
});
