import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { hostPlatform } from './platforms.mjs';
const root = process.cwd();
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  });
  if (result.status !== 0)
    throw new Error(`${command} failed with ${result.status}`, { cause: result.error });
}
run(process.execPath, ['scripts/stage-native.mjs']);
run(process.execPath, ['scripts/pack-release.mjs', '--local']);
const temp = mkdtempSync(join(tmpdir(), 'effectweb-consumer-'));
const version = JSON.parse(readFileSync('packages/runtime/package.json', 'utf8')).version;
const native = `effectweb-compiler-${hostPlatform().suffix}`;
writeFileSync(
  join(temp, 'package.json'),
  JSON.stringify(
    {
      name: 'effectweb-clean-consumer',
      private: true,
      type: 'module',
      dependencies: Object.fromEntries(
        ['effectweb', 'effectweb-compiler', native].map((name) => [
          name,
          `file:${resolve(`artifacts/packages/${name}-${version}.tgz`)}`,
        ]),
      ),
      devDependencies: { effect: '4.0.0-rc.112', vite: '8.2.2', typescript: '5.9.3' },
    },
    null,
    2,
  ),
);
// No install scripts: native compilation cannot silently rescue a broken release package.
run(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
  temp,
);
assert.equal(
  realpathSync(join(temp, 'node_modules/effectweb')),
  join(temp, 'node_modules/effectweb'),
);
for (const name of ['effectweb', 'effectweb-compiler']) {
  const directory = join(temp, 'node_modules', name);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  for (const entry of Object.values(manifest.exports)) {
    for (const target of Object.values(entry))
      assert.ok(existsSync(join(directory, target)), `${name}: missing export ${target}`);
  }
}
writeFileSync(
  join(temp, 'vite.config.mjs'),
  "import { snapshotCompiler } from 'effectweb-compiler/vite'; export default { plugins: [snapshotCompiler()] };\n",
);
writeFileSync(
  join(temp, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      jsx: 'preserve',
      jsxImportSource: 'effectweb',
    },
    include: ['app.tsx'],
  }),
);
writeFileSync(
  join(temp, 'index.html'),
  '<!doctype html><html><head><title>EffectWeb package consumer</title></head><body><div id="app"></div><script type="module" src="/app.tsx"></script></body></html>',
);
writeFileSync(
  join(temp, 'app.tsx'),
  `import { Context, Effect } from 'effect';
import { available, defineTasks, mountView, program, uiRuntime, view, type JSX } from 'effectweb';
class CounterService extends Context.Service<CounterService, { increment: (value: number) => Effect.Effect<number> }>()('Counter') {}
const runtime = uiRuntime(Context.make(CounterService, { increment: value => Effect.succeed(value + 1) }));
const counter = defineTasks({ runtime, init: (_props: {}) => ({}) }).tasks({
  increment: { policy: 'drop', run: (_model, value: number) => Effect.flatMap(CounterService, service => service.increment(value)) },
});
const Frame = view<{ children?: JSX.Element }, never>((props, _send) => <section>{props.children}</section>);
const Counter = counter.view(view((model, send) => {
  const actions = counter.controls(send);
  const count = available(model.tasks.increment) ?? 0;
  return <Frame><button onClick={() => actions.run('increment', count)}>Count: {count}</button></Frame>;
}));
const source = program<{}, never>({ initial: {}, update: model => ({ model }) });
mountView(document.getElementById('app')!, Counter, source);
`,
);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], temp);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], temp);
// Verify public cache/runtime modules also work without a DOM and share one Effect instance.
const { Effect, Context } = await import(
  pathToFileURL(join(temp, 'node_modules/effect/dist/Effect.js')).href
).then(async (effect) => ({
  Effect: effect,
  Context: await import(pathToFileURL(join(temp, 'node_modules/effect/dist/Context.js')).href),
}));
const { makeQueryCache, query, uiRuntime } = await import(
  pathToFileURL(join(temp, 'node_modules/effectweb/dist/index.js')).href
);
const service = Context.Service('package-smoke/service');
const cache = makeQueryCache(uiRuntime(Context.make(service, 'shared')));
const definition = query({ name: 'smoke', load: () => service });
assert.equal(await Effect.runPromise(cache.prefetch(definition, true)), 'shared');
cache.dispose();
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!/^\/(?:assets\/[\w.-]+|index.html)?$/.test(pathname)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(readFileSync(join(temp, 'dist', pathname === '/' ? 'index.html' : pathname)));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Count: 0' }).click();
  await page.getByRole('button', { name: 'Count: 1' }).click();
  await page.getByRole('button', { name: 'Count: 2' }).waitFor();
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}
process.stdout.write(`Clean package consumer passed: ${temp}\n`);
