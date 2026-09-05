import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { cpus } from 'node:os';
import { chromium } from '@playwright/test';

const [directory, output, roundsArgument = '7'] = process.argv.slice(2);
if (!directory || !output)
  throw new Error('Usage: node scripts/benchmark-snapshot.mjs DIST OUTPUT [ROUNDS=7]');
const root = resolve(directory);
const rounds = Number(roundsArgument);
if (!Number.isInteger(rounds) || rounds < 1) throw new Error('Rounds must be positive');
const server = createServer(async (request, response) => {
  const file = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
  if (!file.startsWith(root + '/')) {
    response.writeHead(403).end();
    return;
  }
  try {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Content-Type', extname(file) === '.html' ? 'text/html' : 'text/javascript');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch();
const results = [];
try {
  for (let round = 0; round <= rounds; round++) {
    for (const renderer of ['snapshot']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/benchmarks/snapshot/index.html`);
      const result = await page.evaluate(async (renderer) => {
        const host = document.createElement('div');
        document.body.append(host);
        const frame = () =>
          new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        let fixture;
        const mountStart = performance.now();
        fixture = window.snapshotBenchmark[renderer](host, 1000);
        const mountMs = performance.now() - mountStart;
        await frame();
        const measure = async (action) => {
          const old = new Map(
            [...host.querySelectorAll('article')].map((node) => [node.dataset.id, node]),
          );
          const before = fixture.counters.labels;
          const observer = new MutationObserver(() => {});
          observer.observe(host, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
          });
          const start = performance.now();
          action();
          const cpuMs = performance.now() - start;
          const mutations = observer.takeRecords().length;
          observer.disconnect();
          await frame();
          return {
            cpuMs,
            settledMs: performance.now() - start,
            mutations,
            labels: fixture.counters.labels - before,
            replaced: [...host.querySelectorAll('article')].filter(
              (node) => old.has(node.dataset.id) && old.get(node.dataset.id) !== node,
            ).length,
          };
        };
        const edits = [];
        for (let edit = 0; edit < 30; edit++)
          edits.push(await measure(() => fixture.edit(500, `Edited ${edit}`)));
        const unrelated = await measure(() => fixture.set({ title: 'Title changed' }));
        const prepend = await measure(() => fixture.prepend(50));
        const reverse = await measure(() => fixture.reverse());
        const hide = await measure(() => fixture.set({ visible: false }));
        const show = await measure(() => fixture.set({ visible: true }));
        fixture.dispose();
        const disposedNodes = host.childNodes.length;
        return { mountMs, edits, unrelated, prepend, reverse, hide, show, disposedNodes };
      }, renderer);
      if (round) results.push({ round, renderer, ...result, errors });
      await page.close();
    }
  }
  const report = {
    date: new Date().toISOString(),
    browser: browser.version(),
    cpu: cpus()[0]?.model,
    rounds,
    warmupPairs: 1,
    rows: 1000,
    results,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const renderer of ['snapshot']) {
    const runs = results.filter((run) => run.renderer === renderer);
    const workloads = Object.fromEntries(
      ['unrelated', 'prepend', 'reverse', 'hide', 'show'].map((key) => [
        key,
        median(runs.map((run) => run[key].cpuMs)),
      ]),
    );
    process.stdout.write(
      JSON.stringify({
        renderer,
        mount: median(runs.map((run) => run.mountMs)),
        edit: median(runs.flatMap((run) => run.edits.map((edit) => edit.cpuMs))),
        ...workloads,
        errors: runs.flatMap((run) => run.errors),
      }) + '\n',
    );
  }
} finally {
  await browser.close();
  server.close();
}
