import { build } from 'vite';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
mkdirSync(resolve('artifacts'), { recursive: true });
const directory = mkdtempSync(resolve('artifacts/bundle-'));
const cases = {
  owner: `import { modelOwner } from 'effectweb'; window.app=modelOwner({count:0});`,
  ownedQuery: `import { modelOwner, makeQueryCache, query, observeQuery } from 'effectweb'; import { Effect } from 'effect'; const app=modelOwner({result:undefined}); const cache=app.own(makeQueryCache()); const source=observeQuery(app,cache,query({name:'sample',load:()=>Effect.succeed(1)}),result=>app.patch({result})); source.select(true); window.app=app;`,
  unusedView: `import { view, mountView } from 'effectweb'; const Unused = view((model, send) => <button onClick={() => send(model.id)}><span>UNUSED_VIEW_MARKER</span>{model.label}</button>); const View = view((model, send) => <p>{model.text}</p>); mountView(document.body, View, {model:()=>({text:'hello'}),send:()=>{},subscribe:()=>()=>{}});`,
  view: `import { view, mountView } from 'effectweb'; const View = view((model, send) => <p>{model.text}</p>); mountView(document.body, View, {model:()=>({text:'hello'}),send:()=>{},subscribe:()=>()=>{}});`,
  program: `import { program } from 'effectweb'; const app=program({initial:0, update:(model, n)=>({model:model+n})}); window.app=app;`,
  query: `import { makeQueryCache, query } from 'effectweb'; import { Effect } from 'effect'; const cache=makeQueryCache(); window.cache=cache; window.load=()=>cache.prefetch(query({name:'sample',load:()=>Effect.succeed(1)}),true);`,
};
const { effectweb } = await import('../packages/compiler/dist/vite.js');
const report = {};
try {
  for (const [name, source] of Object.entries(cases)) {
    const entry = join(directory, name + '.tsx');
    writeFileSync(entry, source);
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [effectweb()],
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ['es'] },
        rolldownOptions: { output: { codeSplitting: false } },
      },
    });
    const chunks = (Array.isArray(output) ? output : [output])
      .flatMap((o) => o.output)
      .filter((item) => item.type === 'chunk');
    const code = chunks.map((c) => c.code).join('\n');
    if (process.argv.includes('--check'))
      assert.ok(!code.includes('UNUSED_VIEW_MARKER'), 'Unused view template remains in the bundle');
    const modules = chunks
      .flatMap((c) =>
        Object.entries(c.modules).map(([id, m]) => ({
          id: id.replace(process.cwd() + '/', ''),
          bytes: m.renderedLength,
        })),
      )
      .sort((a, b) => b.bytes - a.bytes);
    report[name] = { bytes: Buffer.byteLength(code), gzip: gzipSync(code).length, modules };
  }
  if (process.argv.includes('--check')) {
    // Includes owned nested content arrays and post-reconciliation control commits.
    assert.ok(report.view.gzip < 3250, 'Renderer exceeds its 3.25 KB gzip budget');
    assert.ok(report.unusedView.gzip < report.view.gzip + 100, 'Unused views retain runtime code');
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
