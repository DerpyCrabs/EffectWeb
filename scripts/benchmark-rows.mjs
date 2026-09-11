import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error('Usage: node scripts/benchmark-rows.mjs DIST OUTPUT');
const root = resolve(directory);
const server = createServer((request, response) => {
  const file = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
  if (!file.startsWith(root + '/')) return response.writeHead(403).end();
  response.setHeader('Content-Type', extname(file) === '.html' ? 'text/html' : 'text/javascript');
  readFile(file)
    .then((data) => response.end(data))
    .catch(() => response.writeHead(404).end());
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch();
const results = [];
try {
  for (let round = 0; round < 6; round++)
    for (const optimized of [false, true]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/benchmarks/snapshot/index.html`);
      await page.evaluate(async (optimized) => {
        const host = document.createElement('div');
        document.body.append(host);
        window.rowRun = { host, fixture: await window.snapshotBenchmark.rows(host, optimized) };
        for (let i = 0; i < 20; i++)
          window.rowRun.fixture.send({ type: 'select', id: i % 2 ? 0 : 500 });
      }, optimized);
      const session = await page.context().newCDPSession(page);
      await session.send('HeapProfiler.collectGarbage');
      await session.send('HeapProfiler.startSampling', {
        samplingInterval: 4096,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      const work = await page.evaluate(() => {
        const { host, fixture } = window.rowRun;
        const before = fixture.evaluations();
        const observer = new MutationObserver(() => {});
        observer.observe(host, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true,
        });
        const start = performance.now();
        for (let i = 0; i < 200; i++) fixture.send({ type: 'select', id: i % 2 ? 0 : 500 });
        const cpuMs = performance.now() - start;
        const mutations = observer.takeRecords().length;
        observer.disconnect();
        return { cpuMs, mutations, evaluations: fixture.evaluations() - before };
      });
      const { profile } = await session.send('HeapProfiler.stopSampling');
      const allocated = profile.samples.reduce((sum, sample) => sum + sample.size, 0);
      await page.evaluate(() => window.rowRun.fixture.close());
      if (errors.length) throw new Error(errors.join('\n'));
      if (work.evaluations !== (optimized ? 400 : 200000) || work.mutations !== 400)
        throw new Error(`Unexpected rendering work: ${JSON.stringify(work)}`);
      if (round) results.push({ round, optimized, ...work, sampledAllocationBytes: allocated });
      await page.close();
    }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = [false, true].map((optimized) => {
    const runs = results.filter((run) => run.optimized === optimized);
    return {
      optimized,
      cpuMs: median(runs.map((run) => run.cpuMs)),
      sampledAllocationBytes: median(runs.map((run) => run.sampledAllocationBytes)),
      evaluations: runs[0].evaluations,
      mutations: runs[0].mutations,
    };
  });
  await writeFile(
    output,
    JSON.stringify({ rows: 1000, updates: 200, rounds: 5, warmup: 1, summary, results }, null, 2) +
      '\n',
  );
  process.stdout.write(JSON.stringify(summary) + '\n');
} finally {
  await browser.close();
  server.close();
}
