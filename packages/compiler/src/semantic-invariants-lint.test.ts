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

it('does not confuse cached view allocations with a helper’s private scratch data', () => {
  const source = `import {view} from 'effectweb';
    const append=(items,value)=>{items.push(value);return items.length};
    view(m=>{const items=[];return <p>{append(items,m.value)}</p>});`;
  expect(() => checkRender(source, 'cached-allocation.tsx')).toThrow(/mutat|borrowed/u);
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
  `import {mountView} from 'effectweb';view(m=><p>{mountView(m.element,m.view,m.source)}</p>);`,
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
