// Compare the publication hot paths against an optional saved runtime src directory.
// node scripts/benchmark-owner.mjs /tmp/baseline/src /tmp/owner-benchmark.json
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const current = new URL('../packages/runtime/src/', import.meta.url).pathname;
const baseline = process.argv[2] && resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? join(tmpdir(), 'effectweb-owner-benchmark.json'));
const variants = baseline ? { baseline, current } : { current };
const directory = await mkdtemp(join(tmpdir(), 'effectweb-owner-'));
const steps = 200;
const rounds = 5;
const cases = ['nested', 'flat', 'queued-flat', 'clone-tree', 'array'];
const entry = `
import { modelOwner } from './owner.ts';
import { Effect } from 'effect';
window.measure = (kind, steps) => {
  const payload = Object.fromEntries(Array.from({length:10000}, (_,i) => ['f'+i, i]));
  const rows = Array.from({length:96}, (_,id) => ({id, files:Array.from({length:200}, (_,i) => ({name:'file-'+i, size:i}))}));
  const owner = modelOwner(kind.endsWith('flat') ? {...payload, tick:0} : {payload, rows, array:Array.from({length:19200},(_,i)=>i), tick:0});
  let publications = 0;
  owner.source.subscribe(() => publications++);
  const update = () => {
    const model = owner.read();
    owner.patch(kind === 'clone-tree'
      ? {tick:model.tick+1, rows:model.rows.map(row=>({...row,files:row.files.map(file=>({...file}))}))}
      : kind === 'array' ? {tick:model.tick+1, array:[...model.array]}
      : {tick:model.tick+1});
  };
  const batch = (count) => {
    const repeat = () => { for(let i=0;i<count;i++) update(); };
    if(kind === 'queued-flat') owner.run('burst', Effect.sync(repeat), 'drop');
    else repeat();
  };
  batch(40);
  const start = performance.now();
  batch(steps);
  const ms = performance.now()-start;
  const valid = owner.read().tick === steps+40 && owner.source.model().tick === steps+40 && publications === steps+40;
  owner.dispose();
  return {ms, valid};
};`;
let browser;
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Owner benchmark</title>');
  } else {
    const name = request.url?.slice(1);
    if (!name || !/^(baseline|current)-(development|production)\.js$/u.test(name)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'text/javascript');
    readFile(join(directory, name))
      .then((data) => response.end(data))
      .catch(() => response.writeHead(500).end());
  }
});
try {
  for (const [name, source] of Object.entries(variants))
    for (const mode of ['development', 'production'])
      await build({
        stdin: { contents: entry, resolveDir: source, sourcefile: 'benchmark.ts', loader: 'ts' },
        bundle: true,
        format: 'esm',
        minify: true,
        define: { __EFFECTWEB_DEV__: String(mode === 'development') },
        outfile: join(directory, `${name}-${mode}.js`),
        logLevel: 'silent',
      });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (let round = 0; round < rounds; round++)
    for (const mode of ['production', 'development'])
      for (const kind of cases)
        for (const variant of round % 2 ? Object.keys(variants).reverse() : Object.keys(variants)) {
          const page = await browser.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(`http://127.0.0.1:${server.address().port}/`);
          await page.addScriptTag({ type: 'module', url: `/${variant}-${mode}.js` });
          await page.waitForFunction(() => typeof window.measure === 'function');
          const result = await page.evaluate(({ kind, steps }) => window.measure(kind, steps), {
            kind,
            steps,
          });
          assert.ok(result.valid, `${variant} ${mode} ${kind}: incorrect publications`);
          assert.deepEqual(errors, []);
          results.push({ round, mode, kind, variant, msPerUpdate: result.ms / steps });
          await page.close();
        }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = [];
  for (const mode of ['production', 'development'])
    for (const kind of cases)
      summary.push({
        mode,
        kind,
        ...Object.fromEntries(
          Object.keys(variants).map((variant) => [
            variant,
            median(
              results
                .filter((r) => r.mode === mode && r.kind === kind && r.variant === variant)
                .map((r) => r.msPerUpdate),
            ),
          ]),
        ),
      });
  const report = {
    date: new Date().toISOString(),
    browser: browser.version(),
    steps,
    rounds,
    variants,
    summary,
    results,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.table(summary);
  console.log(output);
} finally {
  await browser?.close();
  server.close();
  await rm(directory, { recursive: true, force: true });
}
