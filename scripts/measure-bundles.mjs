import { build } from 'vite';
import { build as buildEsbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
mkdirSync(resolve('artifacts'), { recursive: true });
const directory = mkdtempSync(resolve('artifacts/bundle-'));
const cases = {
  owner: `import { modelOwner } from 'effectweb'; window.app=modelOwner({count:0});`,
  ownedQuery: `import { modelOwner } from 'effectweb'; import { queryCache, query, observeQuery } from '@effectweb/query'; import { Effect } from 'effect'; const app=modelOwner({result:undefined}); const cache=app.own(queryCache()); const source=observeQuery(app,cache,query({name:'sample',load:()=>Effect.succeed(1)}),result=>app.patch({result})); source.select(true); window.app=app;`,
  unusedView: `import { view, mount } from 'effectweb'; const Unused = view((model, send) => <button onClick={() => send(model.id)}><span>UNUSED_VIEW_MARKER</span>{model.label}</button>); const View = view((model, send) => <p>{model.text}</p>); mount(document.body, View, {model:()=>({text:'hello'}),send:()=>{},subscribe:()=>()=>{}});`,
  view: `import { view, mount } from 'effectweb'; const View = view((model, send) => <p>{model.text}</p>); mount(document.body, View, {model:()=>({text:'hello'}),send:()=>{},subscribe:()=>()=>{}});`,
  program: `import { program } from 'effectweb'; const app=program({initial:0, update:(model, n)=>({model:model+n})}); window.app=app;`,
  query: `import { queryCache, query } from '@effectweb/query'; import { Effect } from 'effect'; const cache=queryCache(); window.cache=cache; window.load=()=>cache.prefetch(query({name:'sample',load:()=>Effect.succeed(1)}),true);`,
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
    // Includes Effect cancellation/settlement, owned content and native control/event bindings.
    assert.ok(report.unusedView.gzip < report.view.gzip + 100, 'Unused views retain runtime code');
  }
  // Rolldown removes unused Effect barrel exports that esbuild currently retains. Exercise
  // both bundlers so small adapters and basic mounting do not retain unused Effect APIs.
  for (const [name, gzipLimit] of [
    ['keycloak', 20_000],
    ['tanstack-form', 30_000],
    ['mount', 20_000],
  ]) {
    const output = await buildEsbuild({
      stdin: {
        contents:
          name === 'mount'
            ? `import { makeMount } from 'effectweb'; window.mount = makeMount;`
            : `import * as adapter from '@effectweb/${name}'; window.adapter = adapter;`,
        resolveDir: process.cwd(),
      },
      tsconfigRaw: {},
      bundle: true,
      minify: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const code = output.outputFiles[0].contents;
    const gzip = gzipSync(code).length;
    report[`esbuild-${name}`] = { bytes: code.length, gzip };
    if (process.argv.includes('--check'))
      assert.ok(gzip < gzipLimit, `${name} esbuild bundle exceeds ${gzipLimit} gzip bytes`);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
