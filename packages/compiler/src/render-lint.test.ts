import { expect, it } from 'vitest';
import { compile as compileSource, lint } from './compile';

const checkRender = (source: string) => {
  const text = `import { view } from 'effectweb'; ${source}`;
  const errors = lint(text, 'contract.tsx').filter((issue) => issue.severity === 'error');
  if (errors.length)
    throw new Error(
      errors
        .map((issue) => `${issue.file}:${issue.line}:${issue.column}: ${issue.message}`)
        .join('\n'),
    );
  return compileSource(text, 'contract.tsx').code;
};

it.each([
  `let external='old'; const read=()=>external; view(model=><p>{read()}</p>);`,
  `let external='old'; function read(){return external;} const label=()=>read(); view(model=><p>{label()}</p>);`,
  `const clock=Date; view(model=><p>{clock.now()}</p>);`,
  `const clock=Date; const now=()=>clock.now(); view(model=><p>{now()}</p>);`,
  `let external='old'; const read=()=>external; const alias=read; view(model=><p>{alias()}</p>);`,
  `let external='old'; const read=()=>external; view(model=>{const alias=read;return <p>{alias()}</p>;});`,
])('diagnoses mutable render dependencies hidden by same-file helpers: %s', (source) => {
  expect(() => checkRender(source)).toThrow(/Mutable capture|Read Date/u);
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
  expect(() => checkRender(`${source} view(model=><b>{read(model.value)}</b>);`)).toThrow(
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
  `const read=(input)=>{const globalThis={Date:{now:()=>input}};return globalThis.Date.now();};`,
])('allows pure helpers to mutate their own bindings and fresh buffers: %s', (source) => {
  expect(checkRender(`${source} view(model=><b>{read(model.value)}</b>);`)).toContain('.markup(');
});

it.each([
  `let observer; const observe=()=>{observer=window.innerWidth;return ()=>{};}; const mount=()=>domMount(()=>observe()); view(model=><div use={mount()}/>);`,
  `const mount=()=>domMount(element=>{const width=document.documentElement.clientWidth;element.style.width=width+'px';return ()=>{};}); view(model=><div use={mount()}/>);`,
  `const mount=()=>domMount(element=>Effect.gen(function*(){let visible=true;const motion=window.matchMedia('screen');visible=false;yield* Effect.never;})); view(model=><div use={mount()}/>);`,
  `const mount=()=>domBinding('input',()=>{consume(Math.random(),localStorage.getItem('key'));return ()=>{};}); view(model=><div use={mount()}/>);`,
  `view(model=><div use={domMount(()=>consume(window.innerWidth))}/>);`,
  `const mount=()=>domMount(()=>Effect.tryPromise(async()=>{await import('player');await Promise.resolve();}));view(model=><div use={mount()}/>);`,
])('keeps DOM host callback work deferred through render helpers: %s', (source) => {
  expect(checkRender(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toContain(
    '.markup(',
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
    expect(checkRender(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toContain(
      '.markup(',
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
  expect(() => checkRender(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toThrow(
    /Read window|Read document|randomness|Mutable capture/u,
  );
});

it('recognizes aliased host imports and the mount subpath', () => {
  expect(
    checkRender(
      `import { domMount as mount } from 'effectweb/mount'; const host=()=>mount(function(){consume(document.title);return ()=>{};}); view(model=><div use={host()}/>);`,
    ),
  ).toContain('.markup(');
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
  expect(() => checkRender(`import { domMount, domBinding } from 'effectweb'; ${source}`)).toThrow(
    /Read window|Read document|randomness|Cannot prove/u,
  );
});

it('keeps borrowed model mutations rejected inside DOM host callbacks', () => {
  expect(() =>
    checkRender(
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
  expect(() => checkRender(source)).toThrow(/mutating method/u);
});

it('permits event-time randomness without requiring an extracted helper', () => {
  expect(checkRender(`view((model,send)=><button onClick={()=>send(Math.random())}/>);`)).toContain(
    '"onClick":',
  );
  expect(
    checkRender(
      `const random=()=>Math.random();view((model,send)=><button onClick={()=>send(random())}/>);`,
    ),
  ).toContain('"onClick":');
});

it('keeps pure helper locals and event-only work outside render capture checks', () => {
  expect(
    checkRender(
      `const format=(value)=>{let result=value;result+=1;return result;};view(model=><p>{format(model.count)}</p>);`,
    ),
  ).toContain('.markup(');
  expect(
    checkRender(
      `import {defineActions} from 'effectweb';const actions=defineActions()({Run:()=>Date.now()});view((model,send)=>{const dispatch=actions.bind(send);return <button onClick={()=>dispatch.Run()}/>;});`,
    ),
  ).toContain('"onClick":');
  expect(
    checkRender(
      `view(model=><button onClick={()=>{const local=[];local.push(model.id);consume(local);}}/>);`,
    ),
  ).toContain('"onClick":');
  expect(
    checkRender(`const clock=Date; view(model=><p>{clock.UTC(model.year,0,1)}</p>);`),
  ).toContain('.markup(');
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
      checkRender(
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
  expect(() => checkRender(`view(model => <p>{${expression}}</p>)`)).toThrow(
    /mutating method|randomness/u,
  );
});

it.each([
  '[...model.items].sort((a, b) => a - b)',
  '([...model.items] as number[])["reverse"]()',
  '[...model.items][`splice`](0, 1)',
])('allows mutation of a fresh array without mutating the snapshot: %s', (expression) => {
  expect(checkRender(`view(model => <p>{(${expression}).join(",")}</p>)`)).toContain('.markup(');
});

it('still checks work inside a fresh-array comparator', () => {
  expect(() =>
    checkRender(
      'view(model => <p>{[...model.items].sort(() => model.other["pop"]()).join(",")}</p>)',
    ),
  ).toThrow('mutating method pop');
  expect(() =>
    checkRender('view(model => <p>{[...model.groups][0].sort().join(",")}</p>)'),
  ).toThrow('mutating method sort');
});

it('keeps computed service actions and shadowed Math methods available', () => {
  expect(
    checkRender(
      `const service={delete:(id)=>window.alert(id)};view(model => <Dialog confirm={() => service["delete"](model.id)} />)`,
    ),
  ).toContain('.renderComponent(');
  expect(
    checkRender('const Math={random:()=>1};view(model => <p>{Math["random"]()}</p>)'),
  ).toContain('.markup(');
});

it.each([
  'view(model => <p>{document.title}</p>)',
  'view(model => <button onClick={document.getElementById(model.id)} />)',
  'view(model => <p title={(() => document.title)()} />)',
  'view(model => <p title={(() => model.items.sort())()} />)',
  'view((model, send) => <input onChange={event => { model.title = event.currentTarget.value; }} />)',
])('keeps render work and model mutations subject to purity checks: %s', (source) => {
  expect(() => checkRender(source)).toThrow();
});

it('keeps direct spread event callbacks deferred and checks eager spread expressions', () => {
  expect(checkRender(`view(p=><button {...{onClick:()=>window.alert(p.label)}}/>);`)).toContain(
    '...',
  );
  expect(
    checkRender(`view(p=><input {...{onInput:(event)=>{event.currentTarget.value='';}}}/>);`),
  ).toContain('...');
  for (const expression of [
    `{onClick:(()=>window.alert('eager'))()}`,
    `{onClick:make(window.innerWidth)}`,
  ])
    expect(() => checkRender(`view(p=><button {...${expression}}/>);`)).toThrow(
      /Read window|Cannot prove/u,
    );
});

it.each(['effectweb', 'effectweb/effectEvent'])(
  'keeps recognized Effect event callbacks deferred in every attribute form: %s',
  (module) => {
    for (const attribute of [
      `onClick={request('replace', () => Effect.sync(() => records.push('clicked')))}`,
      `{...{ onClick: request('replace', () => Effect.sync(() => records.push('clicked'))) }}`,
    ]) {
      const source = `import {effectEvent as request} from '${module}'; import {Effect} from 'effect'; const records=[]; view(model=><button ${attribute}/>);`;
      expect(checkRender(source)).toContain('.markup(');
    }
  },
);

it.each([
  `onClick={(() => window.alert('eager'))()}`,
  `{...{onClick:(() => window.alert('eager'))()}}`,
  `onClick={make(() => window.alert('eager'))}`,
])('does not treat an arbitrary eager event factory as a deferred callback: %s', (attribute) => {
  expect(() => checkRender(`view(model=><button ${attribute}/>);`)).toThrow(
    /Read window|Cannot prove/u,
  );
});
