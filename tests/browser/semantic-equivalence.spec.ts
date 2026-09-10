import { expect, test } from '@playwright/test';
import { compile } from '../../packages/compiler/src/compile';

const programs = [
  {
    name: 'direct paths',
    prefix: '',
    body: `const result={text:model.user?.name ?? 'none',count:model.items.length};`,
  },
  {
    name: 'destructuring aliases',
    prefix: '',
    body: `const {user,...rest}=model;const {name='none'}=user??{};const result={text:name,count:rest.items.length};`,
  },
  {
    name: 'linked defaults and rest identity',
    prefix: '',
    body: `const {a=[],b=a,...rest}=model.extra;const result={linked:a===b,rest:rest===rest,values:[...a,...b]};`,
  },
  {
    name: 'inline callback',
    prefix: '',
    body: `const result=model.items.map(item=>item.toUpperCase()).join(',');`,
  },
  {
    name: 'extracted callback',
    prefix: `const upper=item=>item.toUpperCase();`,
    body: `const result=model.items.map(upper).join(',');`,
  },
  {
    name: 'callback with intermediate',
    prefix: `const upper=item=>item.toUpperCase();`,
    body: `const values=model.items.map(upper);const result=values.join(',');`,
  },
  {
    name: 'Array.from callback',
    prefix: `const upper=item=>item.toUpperCase();`,
    body: `const result=Array.from(model.items,upper).join(',');`,
  },
  {
    name: 'pure helper',
    prefix: `const format=value=>value.toUpperCase();`,
    body: `const result=format(model.label);`,
  },
  { name: 'imported helper', prefix: '', body: `const result=formatLabel(model.label);` },
  {
    name: 'imported helper with whole-model input',
    prefix: '',
    body: `const result=summarizeUser(model);`,
  },
  {
    name: 'imported helper with capturing callback',
    prefix: '',
    body: `const result=mapLabels(model.items,item=>item+model.label);`,
  },
  {
    name: 'object helper',
    prefix: `const helpers={format:value=>value.toUpperCase(),...{}};`,
    body: `const result=helpers.format(model.label);`,
  },
  {
    name: 'helper through rest',
    prefix: `const helpers={format:value=>value.toUpperCase()};const {...rest}=helpers;`,
    body: `const result=rest.format(model.label);`,
  },
  {
    name: 'higher order helper',
    prefix: `const apply=(fn,value)=>fn(value);const upper=value=>value.toUpperCase();`,
    body: `const result=apply(upper,model.label);`,
  },
  {
    name: 'returned closure',
    prefix: `const make=()=>value=>value.toUpperCase();const upper=make();`,
    body: `const result=upper(model.label);`,
  },
  {
    name: 'optional receiver',
    prefix: '',
    body: `const result=model.user?.name.toUpperCase() ?? 'none';`,
  },
  {
    name: 'optional method',
    prefix: '',
    body: `const result=model.user?.name?.toUpperCase?.() ?? 'none';`,
  },
  {
    name: 'private helper allocation',
    prefix: `const format=items=>{const copy=items.slice();copy.reverse();return copy.join(',')};`,
    body: `const result=format(model.items);`,
  },
  {
    name: 'inline fresh copy',
    prefix: '',
    body: `const result=[...model.items].reverse().join(',');`,
  },
];

for (const development of [true, false]) {
  test(`compiled pure programs match ordinary JavaScript after each publication (development=${development})`, async ({
    page,
  }) => {
    await page.goto('/');
    const runtime = new URL('/tests/fixtures/compilerSemanticsRuntime.ts', page.url()).href;
    const helpers = new URL('/tests/fixtures/renderHelpers.ts', page.url()).href;
    for (const program of programs) {
      await test.step(program.name, async () => {
        const source = `import {Effect,view,list,modelOwner,mountView} from ${JSON.stringify(runtime)};
          import {formatLabel,summarizeUser,mapLabels} from ${JSON.stringify(helpers)};
          ${program.prefix}
          const reference=model=>{${program.body}return JSON.stringify(result)};
          const App=view(model=>{${program.body}return <output>{JSON.stringify(result)}</output>});
          export async function run(){
            const initial={label:'one',user:null,items:['a','B'],extra:{}};
            const owner=modelOwner(initial);
            const host=document.createElement('div');document.body.append(host);
            const unmount=mountView(host,App,owner.source);
            const output=[];
            try{
              const record=()=>output.push({actual:host.textContent,expected:reference(owner.source.model())});
              record();
              owner.patch({label:'two',user:{name:'Ada'},items:['C','d'],extra:{a:['x']}});record();
              owner.patch({label:'three',user:{name:'Grace'},items:[],extra:{a:['y'],b:['z']}});record();
              owner.patch({user:null,items:['last']});record();
              return output;
            }finally{await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
          }`;
        const result = compile(source, `${program.name}.tsx`, {
          development,
          importSource: runtime,
          runtimeModule: runtime,
        });
        const url = `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`;
        const observations = await page.evaluate(async (url) => {
          const fixture = (await import(url)) as {
            run: () => Promise<{ actual: string; expected: string }[]>;
          };
          return fixture.run();
        }, url);
        for (const observation of observations)
          expect(observation.actual).toBe(observation.expected);
      });
    }
  });

  test(`raw object lists retain reference identity (development=${development})`, async ({
    page,
  }) => {
    await page.goto('/');
    const runtime = new URL('/tests/fixtures/compilerSemanticsRuntime.ts', page.url()).href;
    const source = `import {Effect,view,list,modelOwner,mountView} from ${JSON.stringify(runtime)};
      const App=view(model=><ul>{list(model.items,item=><li>{item.label}</li>)}</ul>);
      export async function run(){
        const first={label:'first'},second={label:'second'};
        const owner=modelOwner({items:[first,second]});
        const host=document.createElement('div');document.body.append(host);
        const unmount=mountView(host,App,owner.source);
        try{
          const nodes=Array.from(host.querySelectorAll('li'));
          owner.patch({items:[second,first]});
          const moved=Array.from(host.querySelectorAll('li'));
          const retained=moved[0]===nodes[1]&&moved[1]===nodes[0];
          owner.patch({items:[second,{label:'updated'}]});
          const changed=Array.from(host.querySelectorAll('li'));
          return {retained,replaced:changed[1]!==nodes[0],text:host.textContent};
        }finally{await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
      }`;
    const result = compile(source, 'reference-rows.tsx', {
      development,
      importSource: runtime,
      runtimeModule: runtime,
    });
    const url = `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`;
    const observation = await page.evaluate(async (url) => {
      const fixture = (await import(url)) as {
        run: () => Promise<{ retained: boolean; replaced: boolean; text: string }>;
      };
      return fixture.run();
    }, url);
    expect(observation).toEqual({ retained: true, replaced: true, text: 'secondupdated' });
  });

  test(`custom methods execute normally (development=${development})`, async ({ page }) => {
    await page.goto('/');
    const runtime = new URL('/tests/fixtures/compilerSemanticsRuntime.ts', page.url()).href;
    for (const expression of [
      "copy(model.input).join(',')",
      "Object.assign({},model.input).slice().join(',')",
    ]) {
      const source = `import {Effect,view,list,modelOwner,mountView} from ${JSON.stringify(runtime)};
      const copy=input=>input.slice();
      const App=view(model=><p>{${expression}}</p>);
      export async function run(){
        let calls=0;let unmount;
        const owner=modelOwner({input:{slice(){calls++;return ['custom']}}});
        const host=document.createElement('div');document.body.append(host);
        try{unmount=mountView(host,App,owner.source);return {calls,text:host.textContent,error:null};}
        catch(error){return {calls,error:error.message};}
        finally{if(unmount)await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
      }`;
      const result = compile(source, 'custom-method.tsx', {
        development,
        importSource: runtime,
        runtimeModule: runtime,
      });
      const url = `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`;
      const observation = await page.evaluate(async (url) => {
        const fixture = (await import(url)) as {
          run: () => Promise<{ calls: number; text: string; error: string | null }>;
        };
        return fixture.run();
      }, url);
      expect(observation.calls).toBe(1);
      expect(observation.text).toBe('custom');
      expect(observation.error).toBeNull();
    }
  });
}

for (const development of [true, false]) {
  for (const scenario of ['tagged receiver', 'custom map'] as const) {
    test(`${scenario} preserves JavaScript behavior (development=${development})`, async ({
      page,
    }) => {
      await page.goto('/');
      const runtime = new URL('/tests/fixtures/compilerSemanticsRuntime.ts', page.url()).href;
      const expression =
        scenario === 'tagged receiver'
          ? 'model.input.tag`!`'
          : 'model.input.map(item => <span>{item}</span>)';
      const setup =
        scenario === 'tagged receiver'
          ? "const tag=function(text){return this.label+text[0]};const initial={label:'before',tag};const next={label:'after',tag};"
          : 'const map=function(render){return this.values.filter(value=>value>1).map(render)};const initial={values:[1,2,3],map};const next={values:[1,3,4],map};';
      const source = `import {Effect,view,list,modelOwner,mountView} from ${JSON.stringify(runtime)};
        const App=view(model=><output>{${expression}}</output>);
        export async function run(){
          ${setup}
          const owner=modelOwner({input:initial});
          const host=document.createElement('div');document.body.append(host);
          const unmount=mountView(host,App,owner.source);
          try{
            const texts=[host.textContent];owner.patch({input:next});texts.push(host.textContent);return texts;
          }finally{await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
        }`;
      const result = compile(source, `${scenario}.tsx`, {
        development,
        importSource: runtime,
        runtimeModule: runtime,
      });
      const url = `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`;
      const texts = await page.evaluate(async (url) => {
        const fixture = (await import(url)) as { run: () => Promise<string[]> };
        return fixture.run();
      }, url);
      expect(texts).toEqual(scenario === 'tagged receiver' ? ['before!', 'after!'] : ['23', '34']);
    });
  }
}
