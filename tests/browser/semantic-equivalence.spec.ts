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
    for (const program of programs) {
      await test.step(program.name, async () => {
        const source = `import {view,modelOwner,mountView} from ${JSON.stringify(runtime)};
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
            }finally{await unmount.close();await owner.close();host.remove();}
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

  test(`an untyped method cannot impersonate an intrinsic (development=${development})`, async ({
    page,
  }) => {
    await page.goto('/');
    const runtime = new URL('/tests/fixtures/compilerSemanticsRuntime.ts', page.url()).href;
    for (const expression of [
      "copy(model.input).join(',')",
      "Object.assign({},model.input).slice().join(',')",
    ]) {
      const source = `import {view,modelOwner,mountView} from ${JSON.stringify(runtime)};
      const copy=input=>input.slice();
      const App=view(model=><p>{${expression}}</p>);
      export async function run(){
        let calls=0;
        const owner=modelOwner({input:{slice(){calls++;return ['unexpected']}}});
        const host=document.createElement('div');document.body.append(host);
        try{mountView(host,App,owner.source);return {calls,error:null};}
        catch(error){return {calls,error:error.message};}
        finally{await owner.close();host.remove();}
      }`;
      const result = compile(source, 'intrinsic-identity.tsx', {
        development,
        importSource: runtime,
        runtimeModule: runtime,
      });
      const url = `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`;
      const observation = await page.evaluate(async (url) => {
        const fixture = (await import(url)) as {
          run: () => Promise<{ calls: number; error: string }>;
        };
        return fixture.run();
      }, url);
      expect(observation.calls).toBe(0);
      expect(observation.error).toContain('standard data operation');
    }
  });
}
