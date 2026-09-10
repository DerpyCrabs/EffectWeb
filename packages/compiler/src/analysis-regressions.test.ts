import { expect, it } from 'vitest';
import { compile, diagnose } from './compile.js';

const source = (body: string) => `import { view } from 'effectweb'; ${body}`;

it.each([
  `let label='old'; const helpers={read(){return label}}; view(m=><p>{helpers.read()}</p>);`,
  `let label='old'; const helpers={read:()=>label}; view(m=><p>{helpers['read']()}</p>);`,
  `let label='old'; const helpers={get label(){return label}}; view(m=><p>{helpers.label}</p>);`,
  `let label='old'; const helpers={nested:{read:()=>label}}; view(m=><p>{helpers.nested.read()}</p>);`,
  `let label='old'; const helpers={read:()=>label}; const alias=helpers; view(m=><p>{alias.read()}</p>);`,
  `let label='old'; const helpers={read:()=>label}; const read=helpers.read; view(m=><p>{read()}</p>);`,
  `let label='old'; const helpers={read:()=>label}; const {read}=helpers; view(m=><p>{read()}</p>);`,
  `const helpers={read:()=>Date.now()}; view(m=><p>{helpers.read()}</p>);`,
  `const counter={value:0}; const helpers={read(){return ++counter.value}}; view(m=><p>{helpers.read()}</p>);`,
])('checks captures and purity through a same-file object helper: %s', (body) => {
  expect(() => compile(source(body), 'helpers.tsx')).toThrow(/Mutable capture|Read Date|mutate/u);
  expect(diagnose(source(body), 'helpers.tsx')).toEqual([
    expect.objectContaining({ severity: 'error' }),
  ]);
});

it.each([
  `const helpers={read:(value)=>value.toUpperCase()}; view(m=><p>{helpers.read(m.label)}</p>);`,
  `const helpers={get label(){return 'fixed'}}; view(m=><p>{helpers.label}</p>);`,
  `const helpers={read:(value)=>{const result=[];result.push(value);return result.join(',')}}; view(m=><p>{helpers.read(m.label)}</p>);`,
  `const actions={run:()=>window.alert('clicked')}; view(m=><button onClick={actions.run}/>);`,
  `const helpers={read:(value)=>value, action:()=>window.alert('clicked')}; view(m=><p>{helpers.read(m.label)}</p>);`,
])('keeps pure object helpers and deferred callbacks usable: %s', (body) => {
  expect(diagnose(source(body), 'pure-helpers.tsx')).toEqual([]);
  expect(compile(source(body), 'pure-helpers.tsx').code).toContain('.compiled(');
});

it.each([
  `import { Array, Order } from 'effect'; view(m=><p>{Array.sort(m.items, Order.Number).join(',')}</p>);`,
  `import * as Array from 'effect/Array'; import * as Order from 'effect/Order'; view(m=><p>{Array.sort(m.items, Order.Number).join(',')}</p>);`,
  `import { HashMap as Maps } from 'effect'; view(m=><p>{Maps.size(Maps.set(m.map,'key',1))}</p>);`,
  `import * as HashMap from 'effect/HashMap'; const Maps=HashMap; view(m=><p>{Maps.size(Maps.set(m.map,'key',1))}</p>);`,
  `const helpers={set:(value)=>value+1}; view(m=><p>{helpers.set(m.count)}</p>);`,
])('allows proven pure operations whose names also name native mutators: %s', (body) => {
  expect(diagnose(source(body), 'pure-operations.tsx')).toEqual([]);
  expect(compile(source(body), 'pure-operations.tsx').code).toContain('.compiled(');
});

it.each([
  `view(m=><p>{Object.assign(m,{value:1}).value}</p>);`,
  `const assign=Object.assign; view(m=><p>{assign(m,{value:1}).value}</p>);`,
  `const {assign}=Object; view(m=><p>{assign(m,{value:1}).value}</p>);`,
  `view(m=><p>{Object.defineProperty(m,'value',{value:1}).value}</p>);`,
  `const random=Math.random; view(m=><p>{random()}</p>);`,
  `const {random}=Math; view(m=><p>{random()}</p>);`,
  `const math=Math; view(m=><p>{math.random()}</p>);`,
])('rejects builtin effects through direct calls and immutable aliases: %s', (body) => {
  expect(() => compile(source(body), 'builtin-effects.tsx')).toThrow(/mutat|randomness/u);
});

it.each([
  `view(m=><p>{Object.assign({},m,{value:1}).value}</p>);`,
  `const copy=(input)=>{const result={};Object.assign(result,input);return result}; view(m=><p>{copy(m).value}</p>);`,
  `const Object={assign:(input)=>input}; view(m=><p>{Object.assign(m).value}</p>);`,
  `const Math={random:(input)=>input}; view(m=><p>{Math.random(m.value)}</p>);`,
])('allows owned copies and unrelated shadowed builtin names: %s', (body) => {
  expect(diagnose(source(body), 'owned-copies.tsx')).toEqual([]);
});

it.each([
  `const heading=<h1>Title</h1>; view(m=><main>{heading}</main>);`,
  `const heading=<h1>Title</h1>; const alias=heading; view(m=><main>{alias}</main>);`,
  `const heading=()=> <h1>Title</h1>; view(m=><main>{heading()}</main>);`,
  `const headings={get title(){return <h1>Title</h1>}}; view(m=><main>{headings.title}</main>);`,
])('reports uncompiled external JSX captured by a view: %s', (body) => {
  const text = source(body);
  expect(diagnose(text, 'external-jsx.tsx')).toEqual([
    expect.objectContaining({
      severity: 'error',
      message: expect.stringMatching(/JSX.*outside|uncompiled JSX/u) as unknown,
      remedy: expect.stringMatching(/view|slot/u) as unknown,
    }),
  ]);
  expect(() => compile(text, 'external-jsx.tsx')).toThrow(/JSX.*outside|uncompiled JSX/u);
});

it('leaves unrelated JSX islands and exported compiled views alone', () => {
  const text = source(`const Other=()=> <h1>Other framework</h1>;
    const Heading=view(m=><h1>{m.title}</h1>);
    const App=view(m=><main><Heading title={m.title}/></main>);`);
  expect(diagnose(text, 'islands.tsx')).toEqual([]);
  expect(compile(text, 'islands.tsx').code).toContain('<h1>Other framework</h1>');
});
