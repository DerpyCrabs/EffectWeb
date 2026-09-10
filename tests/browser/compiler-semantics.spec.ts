import { expect, test, type Page } from '@playwright/test';
import { compile } from '../../packages/compiler/src/compile';

async function execute(page: Page, development: boolean, body: string) {
  await page.goto('/');
  const runtime = new URL('/tests/fixtures/compilerSemanticsRuntime.ts', page.url()).href;
  const result = compile(
    `import {Effect,view,modelOwner,mountView} from ${JSON.stringify(runtime)}; ${body}`,
    'compiler-semantics.tsx',
    { importSource: runtime, runtimeModule: runtime, development },
  );
  const url = `data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`;
  return page.evaluate(async (url) => {
    const fixture = (await import(url)) as { run: () => Promise<unknown> };
    return fixture.run();
  }, url);
}

for (const development of [true, false]) {
  test(`destructured values share a render frame and are fresh on the next render (development=${development})`, async ({
    page,
  }) => {
    const result = await execute(
      page,
      development,
      `
      const Child=view(p=><button data-child={p.first===p.second?'same':'different'} onClick={()=>p.pick(p.first)}>Pick</button>);
      const App=view((model,send)=>{
        const {value={id:'default'},...rest}=model.input;
        const [, ...tail]=model.items;
        const {a=[],b=a}={};
        return <section data-rest={rest===rest?'same':'different'} data-default={value===value?'same':'different'} data-array={tail===tail?'same':'different'} data-linked={a===b?'same':'different'}>
          <Child first={rest} second={rest} pick={value=>send({last:value})}/>
          <span>{model.last===rest?'picked':'idle'}</span>
        </section>;
      });
      export async function run(){
        const owner=modelOwner({input:{},items:['a','b'],last:null});
        const host=document.createElement('div');document.body.append(host);
        const unmount=mountView(host,App,{...owner.source,send:patch=>owner.patch(patch)});
        try{
          const section=host.querySelector('section');const button=host.querySelector('button');
          const initial={...section.dataset,child:button.dataset.child};
          button.click();
          const picked=host.querySelector('span').textContent;
          owner.patch({input:{next:true}});
          const replaced=host.querySelector('span').textContent;
          return {initial,picked,replaced,sameButton:button===host.querySelector('button')};
        }finally{await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
      }
    `,
    );
    expect(result).toEqual({
      initial: { rest: 'same', default: 'same', array: 'same', linked: 'same', child: 'same' },
      picked: 'idle',
      replaced: 'idle',
      sameButton: true,
    });
  });

  test(`destructuring observes computed keys and defaults independently of its initializer (development=${development})`, async ({
    page,
  }) => {
    const result = await execute(
      page,
      development,
      `
      const App=view(model=>{const {[model.key]:value=model.fallback}=model.input;return <p>{value}</p>;});
      export async function run(){
        const owner=modelOwner({input:{b:'B'},key:'a',fallback:'A'});
        const host=document.createElement('div');document.body.append(host);
        const unmount=mountView(host,App,owner.source);
        try{
          const values=[host.textContent];
          owner.patch({fallback:'next'});values.push(host.textContent);
          owner.patch({key:'b'});values.push(host.textContent);
          owner.patch({input:{b:'changed'}});values.push(host.textContent);
          return values;
        }finally{await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
      }
    `,
    );
    expect(result).toEqual(['A', 'next', 'B', 'changed']);
  });

  test(`JSX entities decode once in templates, native nodes and props (development=${development})`, async ({
    page,
  }) => {
    const result = await execute(
      page,
      development,
      `
      const Child=view(p=><aside>{p.label}</aside>);
      const App=view(model=><main>
        <p title="Tom &amp; Jerry">&amp; &lt; &#x41; &#128512; &nbsp;</p>
        <div>{model.prefix}&amp; &lt; &#x41;</div>
        <textarea title="A &quot;quote&quot;">&lt;native&gt;</textarea>
        <Child label="&#65;&amp;&#x42;"/>
        <footer>{'&amp; &lt;'}</footer>
        <summary>&amp;lt; &unknown; A&B &amp;</summary>
      </main>);
      export async function run(){
        const owner=modelOwner({prefix:'prefix:'});
        const host=document.createElement('div');document.body.append(host);
        const unmount=mountView(host,App,owner.source);
        try{
          const result={text:host.querySelector('p').textContent,title:host.querySelector('p').title,
            dynamic:host.querySelector('main>div').textContent,native:host.querySelector('textarea').value,
            nativeTitle:host.querySelector('textarea').title,prop:host.querySelector('aside').textContent,
            expression:host.querySelector('footer').textContent,once:host.querySelector('summary').textContent};
          owner.patch({prefix:'updated:'});
          return {...result,updated:host.querySelector('main>div').textContent};
        }finally{await Effect.runPromise(unmount.close());await Effect.runPromise(owner.close());host.remove();}
      }
    `,
    );
    expect(result).toEqual({
      text: '& < A 😀 \u00a0',
      title: 'Tom & Jerry',
      dynamic: 'prefix:& < A',
      native: '<native>',
      nativeTitle: 'A "quote"',
      prop: 'A&B',
      expression: '&amp; &lt;',
      once: '&lt; &unknown; A&B &',
      updated: 'updated:& < A',
    });
  });
}
