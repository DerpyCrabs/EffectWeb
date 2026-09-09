import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { hostPlatform } from './platforms.mjs';
import { verifyLucide } from './lucide-smoke.mjs';
import { packageFilename } from './package-filename.mjs';
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
run(process.execPath, ['scripts/pack-release.mjs', '--local']);
const temp = mkdtempSync(join(tmpdir(), 'effectweb-consumer-'));
const version = JSON.parse(readFileSync('packages/runtime/package.json', 'utf8')).version;
const native = `@effectweb/compiler-${hostPlatform().suffix}`;
writeFileSync(
  join(temp, 'package.json'),
  JSON.stringify(
    {
      name: 'effectweb-clean-consumer',
      private: true,
      type: 'module',
      dependencies: Object.fromEntries(
        ['effectweb', '@effectweb/compiler', '@effectweb/lucide', native].map((name) => [
          name,
          `file:${resolve('artifacts/packages', packageFilename(name, version))}`,
        ]),
      ),
      devDependencies: {
        effect: '4.0.0-rc.112',
        vite: '8.2.2',
        typescript: '5.9.3',
        oxlint: '1.77.0',
        'oxlint-tsgolint': '7.0.2001',
        '@effect/tsgo': '0.32.1',
      },
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
assert.deepEqual(
  readFileSync(join(temp, 'node_modules', native, 'compiler.node')),
  readFileSync('packages/compiler/native/effectweb-compiler.node'),
  'Local packages must contain the compiler built from this checkout',
);
const { compile } = await import(
  pathToFileURL(join(temp, 'node_modules/@effectweb/compiler/dist/index.js')).href
);
const bindingProbe = compile(
  `import {view, ViewBinding} from 'effectweb'; const Child=view(p=><b>{p}</b>); const Parent=view((p,send)=><ViewBinding view={Child} model={p} send={send}/>);`,
  'binding.tsx',
).code;
assert.ok(
  !bindingProbe.includes(', ViewBinding,'),
  'The packaged compiler must lower explicit view bindings',
);
assert.ok(
  compile(
    `import {view} from 'effectweb'; const V=view(p=><button {...p}/>);`,
    'spread.tsx',
  ).code.includes('.bindAttributes('),
);
for (const name of ['effectweb', '@effectweb/compiler', '@effectweb/lucide']) {
  const directory = join(temp, 'node_modules', name);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (name === '@effectweb/compiler') {
    assert.equal(manifest.bin, undefined, 'The compiler must not ship a project-check CLI');
    for (const name of ['./project', './tsconfig.json', './oxlint.json'])
      assert.equal(manifest.exports[name], undefined, 'Project configuration belongs to consumers');
    for (const name of ['typescript', 'oxlint', 'oxlint-tsgolint', '@effect/tsgo'])
      assert.equal(
        manifest.dependencies?.[name],
        undefined,
        'Checker tools are consumer dev dependencies',
      );
    assert.ok(!existsSync(join(directory, 'dist/project.js')));
  }
  for (const entry of Object.values(manifest.exports)) {
    for (const target of (typeof entry === 'string' ? [entry] : Object.values(entry)).filter(
      (target) => !target.includes('*'),
    ))
      assert.ok(existsSync(join(directory, target)), `${name}: missing export ${target}`);
  }
}
const { collection } = await import(
  pathToFileURL(join(temp, 'node_modules/effectweb/dist/collection.js')).href
);
const { shareValue } = await import(
  pathToFileURL(join(temp, 'node_modules/effectweb/dist/share.js')).href
);
const entities = collection((item) => item.id);
const previousEntities = {
  items: [
    { id: 1, name: 'One' },
    { id: 2, name: 'Two' },
  ],
};
const refreshedEntities = shareValue(
  previousEntities,
  { items: structuredClone([...previousEntities.items].reverse()) },
  { items: entities.share },
);
assert.equal(refreshedEntities.items[0], previousEntities.items[1]);
assert.equal(refreshedEntities.items[1], previousEntities.items[0]);

const runtimeExports = await import(
  pathToFileURL(join(temp, 'node_modules/effectweb/dist/index.js')).href
);
assert.equal(typeof runtimeExports.infiniteQuery, 'function');
assert.equal(typeof runtimeExports.keyedTasks, 'function');
run(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-dev',
    'solid-js@2.0.0-rc.7',
    '@solidjs/web@2.0.0-rc.7',
    '@solidjs/vite-plugin@3.0.0-next.39',
  ],
  temp,
);
for (const file of ['mixed-islands.jsx', 'mixed-islands.d.ts'])
  writeFileSync(join(temp, file), readFileSync(`tests/fixtures/${file}`));

writeFileSync(
  join(temp, 'vite.config.mjs'),
  "import { effectweb } from '@effectweb/compiler/vite'; export default { plugins: [effectweb()] };\n",
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
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      noUncheckedSideEffectImports: true,
      noImplicitOverride: true,
      forceConsistentCasingInFileNames: true,
      allowUnreachableCode: false,
      allowUnusedLabels: false,
      skipLibCheck: true,
      resolveJsonModule: false,
      noEmit: true,
      jsx: 'preserve',
      jsxImportSource: 'effectweb',
    },
    include: ['*.ts', '*.tsx'],
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
import { Camera } from '@effectweb/lucide';
import AlarmCheck from '@effectweb/lucide/icons/alarm-check';
import type { IconName } from '@effectweb/lucide/dynamic';
import { mountAuthoring } from './authoringFixture';
import { mountContracts } from './contractsFixture';
import { ownershipContracts } from './ownershipFixture';
import { Editor } from './safeAuthoringFixture';
import { createLazyViewFixture } from './lazyViewFixture';
import { mountPortal } from './portalFixture';
Object.assign(window, { mountAuthoring, mountContracts, ownershipContracts, Editor, createLazyViewFixture, mountPortal });
const name: IconName = 'camera';
// @ts-expect-error Unknown icon names must fail at compile time.
const badName: IconName = 'not-a-lucide-icon';
class CounterService extends Context.Service<CounterService, { increment: (value: number) => Effect.Effect<number> }>()('Counter') {}
const runtime = uiRuntime(Context.make(CounterService, { increment: value => Effect.succeed(value + 1) }));
const counter = defineTasks({ runtime, init: (_props: {}) => ({}) }).tasks({
  increment: { policy: 'drop', run: (_model, value: number) => Effect.flatMap(CounterService, service => service.increment(value)) },
});
const Frame = view<{ children?: JSX.Element }, never>((props, _send) => <section>{props.children}</section>);
const Counter = counter.view(view((model, send) => {
  const actions = counter.controls(send);
  const count = available(model.tasks.increment) ?? 0;
  return <Frame><button onClick={() => actions.run('increment', count)}><Camera size={24 + count} title="Take a photo" data-count={count} /><AlarmCheck aria-label="Alarm" />Count: {count}</button></Frame>;
}));
const source = program<{}, never>({ initial: {}, update: model => ({ model }) });
document.documentElement.dataset.snapshotFrozen = String(Object.isFrozen(source.model()));
mountView(document.getElementById('app')!, Counter, source);
`,
);
writeFileSync(
  join(temp, 'authoringFixture.tsx'),
  readFileSync('tests/fixtures/authoringFixture.tsx'),
);
for (const file of [
  'contractsFixture.tsx',
  'scalarContract.ts',
  'ownershipFixture.tsx',
  'safeAuthoringFixture.tsx',
  'lazyViewFixture.tsx',
  'lazyViewModule.tsx',
  'portalFixture.tsx',
  'nativeEventsFixture.tsx',
]) {
  writeFileSync(join(temp, file), readFileSync(`tests/fixtures/${file}`));
}
for (const file of [
  'contracts.typecheck.tsx',
  'async.typecheck.tsx',
  'query.typecheck.ts',
  'commands.typecheck.ts',
  'tasks.typecheck.ts',
  'large-project.typecheck.ts',
  'lazy.typecheck.tsx',
  'portal.typecheck.tsx',
  'native-jsx.typecheck.ts',
]) {
  const source = readFileSync(`packages/runtime/src/${file}`, 'utf8').replace(
    /(['"])\.\/([A-Za-z-]+)\.js\1/gu,
    (_match, quote, module) =>
      `${quote}${['AsyncContent', 'owner', 'dom', 'index', 'snapshot'].includes(module) ? 'effectweb' : `effectweb/${module}`}${quote}`,
  );
  writeFileSync(join(temp, file), source);
}
writeFileSync(
  join(temp, '.oxlintrc.json'),
  JSON.stringify({
    jsPlugins: ['@effectweb/compiler/oxlint'],
    rules: { 'effectweb/valid-view': 'error' },
  }),
);
run(process.execPath, ['node_modules/oxlint/bin/oxlint', '--no-ignore', 'app.tsx'], temp);
const lintProbe = join(temp, 'lint-probe.tsx');
writeFileSync(
  lintProbe,
  `import { view } from 'effectweb';
const Bad = view((model: { items: number[] }) => {
  const sorted = model.items.sort();
  return <p>{sorted.length}</p>;
});`,
);
const lint = spawnSync(
  process.execPath,
  ['node_modules/oxlint/bin/oxlint', '--no-ignore', '--format', 'json', 'lint-probe.tsx'],
  { cwd: temp, encoding: 'utf8' },
);
assert.equal(lint.status, 1, 'Invalid view must fail the packed lint integration');
const diagnostics = JSON.parse(lint.stdout).diagnostics;
assert.ok(
  diagnostics.some(
    (d) => d.code?.includes('valid-view') && d.message.includes('mutating method sort'),
  ),
  lint.stdout,
);
writeFileSync(
  lintProbe,
  `import { view } from 'effectweb';
const Good = view((model: { items: number[] }) => {
  // oxlint-disable-next-line effectweb/valid-view
  const sorted = model.items.sort();
  return <p>{sorted.length}</p>;
});`,
);
run(process.execPath, ['node_modules/oxlint/bin/oxlint', '--no-ignore', 'lint-probe.tsx'], temp);
// The suppression probe deliberately bypasses the compiler; remove it before build/type checks.
unlinkSync(lintProbe);
// These are the consumer's own tools and configuration, independent of the compiler package.
run(
  process.execPath,
  ['node_modules/@effect/tsgo/dist/effect-tsgo.cjs', 'patch', '--no-typescript', '--oxlint'],
  temp,
);
writeFileSync(
  join(temp, '.oxlintrc.json'),
  JSON.stringify({
    plugins: ['typescript', 'effecttsgo'],
    jsPlugins: ['@effectweb/compiler/oxlint'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'effectweb/valid-view': 'error',
      'effectweb/query-key': 'error',
      'effecttsgo/floating-effect': 'error',
      'typescript/no-explicit-any': 'error',
      'typescript/no-floating-promises': ['error', { ignoreVoid: false }],
      'typescript/no-misused-promises': 'error',
      'typescript/no-unsafe-argument': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-return': 'error',
      'typescript/switch-exhaustiveness-check': 'error',
    },
  }),
);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], temp);
const lintFiles = readdirSync(temp).filter((name) => /\.tsx?$/u.test(name));
run(
  process.execPath,
  ['node_modules/oxlint/bin/oxlint', '--no-ignore', '--type-aware', '--type-check', ...lintFiles],
  temp,
);
const projectProbe = join(temp, 'unrelated.ts');
writeFileSync(projectProbe, 'export const label: string = 123;\n');
const consumerTsconfig = readFileSync(join(temp, 'tsconfig.json'));
unlinkSync(join(temp, 'tsconfig.json'));
// A library build works without tsconfig and does not check unrelated application sources.
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], temp);
writeFileSync(join(temp, 'tsconfig.json'), consumerTsconfig);
unlinkSync(projectProbe);
const bundle = readdirSync(join(temp, 'dist/assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(temp, 'dist/assets', name), 'utf8'))
  .join('\n');
assert.ok(bundle.includes('lucide-camera'), 'Named import missing from bundle');
assert.ok(!bundle.includes('lucide-a-arrow-down'), 'Unused icon leaked into the bundle');
assert.ok(
  !bundle.includes('Could not load Lucide icon'),
  'Dynamic registry leaked into the bundle',
);
assert.ok(bundle.length < 160_000, `Icon consumer unexpectedly large: ${bundle.length} bytes`);
// Build optional integrations separately so the existing core/icon bundle budget stays meaningful.
writeFileSync(
  join(temp, 'mixed.html'),
  '<!doctype html><html><body><script type="module" src="/mixed-islands-entry.jsx"></script></body></html>',
);
writeFileSync(
  join(temp, 'mixed-islands-entry.jsx'),
  "import { mountMixedIslands } from './mixed-islands.jsx'; Object.assign(window, { mountMixedIslands });\n",
);
writeFileSync(
  join(temp, 'vite.mixed.config.mjs'),
  "import { effectweb } from '@effectweb/compiler/vite'; import solid from '@solidjs/vite-plugin'; export default { base: '/mixed/', plugins: [effectweb(), solid()], build: { outDir: 'mixed-dist', rollupOptions: { input: 'mixed.html' } } };\n",
);
run(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.mixed.config.mjs'],
  temp,
);

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
assert.equal(cache.setQueryData(definition, true, 'written'), 'written');
assert.equal(
  cache.updateQueryData(definition, true, (value) => `${value}:updated`),
  'written:updated',
);
assert.equal(await Effect.runPromise(cache.prefetch(definition, true)), 'written:updated');
cache.dispose();
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!/^\/(?:assets\/[\w.-]+|index.html|mixed\/(?:assets\/[\w.-]+|mixed.html))?$/.test(pathname)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    const mixed = pathname.startsWith('/mixed/');
    response.end(
      readFileSync(
        join(
          temp,
          mixed ? 'mixed-dist' : 'dist',
          mixed ? pathname.slice('/mixed/'.length) : pathname === '/' ? 'index.html' : pathname,
        ),
      ),
    );
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
  await page.getByRole('img', { name: 'Take a photo' }).waitFor();
  await page.evaluate(() => {
    window.originalCamera = document.querySelector('.lucide-camera');
  });
  await page.getByRole('button').click();
  await page.getByRole('button').click();
  await page.getByRole('button').filter({ hasText: 'Count: 2' }).waitFor();
  assert.equal(await page.locator('.lucide-camera').getAttribute('width'), '26');
  assert.equal(
    await page.locator('html').getAttribute('data-snapshot-frozen'),
    'true',
    'Published plain snapshots must stay protected in production',
  );
  assert.equal(
    await page.evaluate(() => window.originalCamera === document.querySelector('.lucide-camera')),
    true,
  );
  const islands = await browser.newPage();
  islands.on('pageerror', (error) => errors.push(error.message));
  const mixedResponse = await islands.goto(
    `http://127.0.0.1:${server.address().port}/mixed/mixed.html`,
  );
  assert.equal(mixedResponse.status(), 200);
  await islands.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'mixed-islands';
    document.body.append(host);
    window.stopMixedIslands = window.mountMixedIslands(host);
  });
  await islands.getByRole('button', { name: 'Solid 0', exact: true }).click();
  await islands.getByRole('button', { name: 'EffectWeb 0', exact: true }).click();
  await islands.getByRole('button', { name: 'Solid 1', exact: true }).waitFor();
  await islands.getByRole('button', { name: 'EffectWeb 1', exact: true }).waitFor();
  await islands.evaluate(() => {
    window.stopMixedIslands();
    document.getElementById('mixed-islands').remove();
  });
  assert.equal(await islands.getByRole('button', { name: 'EffectWeb 1', exact: true }).count(), 0);
  await islands.close();
  const authoring = await page.evaluate(async () => {
    const host = document.createElement('section');
    document.body.append(host);
    const fixture = window.mountAuthoring(host);
    await new Promise((done) => setTimeout(done, 0));
    const button = host.querySelector('[data-spread]');
    const before = [...host.querySelectorAll('[data-ordinary]')].map((node) => node.textContent);
    button.click();
    fixture.replace();
    await new Promise((done) => setTimeout(done, 0));
    button.click();
    host.querySelector('[data-dispatched]').click();
    host.querySelector('[data-inline]').click();
    const result = {
      before,
      after: [...host.querySelectorAll('[data-ordinary]')].map((node) => node.textContent),
      selected: fixture.source.model().selected,
      inline: host.querySelector('[data-inline]').getAttribute('data-clicked'),
      sameNode: button === host.querySelector('[data-spread]'),
    };
    fixture.dispose();
    button.click();
    host.remove();
    return { ...result, clicks: fixture.clicks, hosts: fixture.hosts };
  });
  assert.deepEqual(authoring, {
    before: ['first:', 'child:explicit'],
    after: ['second:', 'changed child:explicit'],
    selected: 'second',
    inline: 'second',
    sameNode: true,
    clicks: ['old', 'new'],
    hosts: ['start:old', 'stop:old', 'start:new', 'stop:new'],
  });
  const ownership = await page.evaluate(() => window.ownershipContracts());
  assert.deepEqual(
    ownership.lifecycle,
    Array.from({ length: 8 }, () => ({
      started: ['started'],
      afterUpdate: ['started'],
      errors: [],
    })),
  );
  assert.deepEqual(
    ownership.optionalTransitions,
    Array.from({ length: 4 }, () => ({
      events: ['started', 'interrupted', 'replacement', 'replacement interrupted'],
      errors: [],
    })),
  );
  assert.deepEqual(ownership.optionalEvents, { direct: [], spread: [] });
  assert.deepEqual(ownership.modelSpreadEvents, ['started']);
  assert.deepEqual(ownership.selfRemoval, {
    model: { show: false },
    dom: '',
    cleanups: ['disposed'],
  });
  assert.equal(ownership.blurDraft, 'unfinished draft');
  assert.equal(ownership.publishedDraft, 'published edit');
  const contracts = await page.evaluate(async () => {
    const host = document.createElement('section');
    document.body.append(host);
    const fixture = window.mountContracts(host);
    await new Promise((done) => setTimeout(done, 0));
    const selections = () => Array.from(host.querySelectorAll('select'), (node) => node.value);
    const before = selections();
    host.querySelector('[data-bound]').click();
    const clicked = fixture.source.model().clicked;
    const first = host.querySelector('[data-cell]');
    fixture.source.send({
      selected: 'c',
      options: ['b', 'c'],
      style: { color: 'green' },
      label: 'packed',
    });
    const after = selections();
    fixture.source.send({ options: [] });
    fixture.source.send({ options: ['x', 'c'] });
    const restored = selections();
    const values = {
      before,
      after,
      restored,
      clicked,
      styles: Array.from(host.querySelectorAll('[data-style],[data-style-spread]'), (node) => [
        node.style.color,
        node.style.backgroundColor,
      ]),
      falseValues: [
        host.querySelector('[data-spell]').spellcheck,
        host.querySelector('[data-drag]').draggable,
        host.querySelector('[data-edit]').isContentEditable,
        host.querySelector('[data-translate]').translate,
      ],
      staticValues: ['draggable', 'spellcheck', 'contenteditable'].map((name) =>
        host.querySelector('[data-static]').getAttribute(name),
      ),
      staticTranslate: host.querySelector('[data-static]').getAttribute('translate'),
      download: host.querySelector('[data-download]').getAttribute('download'),
      content: host.querySelector('[data-values]').textContent,
      sameCell: first === host.querySelector('[data-cell]'),
      cells: Array.from(host.querySelectorAll('[data-cell]'), (node) => node.textContent),
      scalar: host.querySelector('[data-scalar]').textContent,
      portal: document.querySelector('[data-overlay]').textContent,
      ordinary: host.querySelector('[data-own-portal]').textContent,
    };
    fixture.dispose();
    host.remove();
    return {
      ...values,
      errors: fixture.errors,
      lifetime: fixture.lifetime(),
      portalRemoved: !document.querySelector('[data-overlay]'),
    };
  });
  assert.deepEqual(contracts, {
    before: ['b', 'b'],
    after: ['c', 'c'],
    restored: ['c', 'c'],
    clicked: 1,
    styles: [
      ['green', ''],
      ['green', ''],
    ],
    falseValues: [false, false, false, false],
    staticTranslate: 'no',
    download: null,
    staticValues: ['false', 'false', 'false'],
    content: 'ab2',
    sameCell: true,
    cells: ['packed:one', 'packed:two'],
    scalar: 'packed',
    portal: 'packed',
    ordinary: 'packed',
    errors: [],
    lifetime: { starts: 2, stops: 2 },
    portalRemoved: true,
  });
  const placement = await page.evaluate(async () => {
    const host = document.createElement('section');
    const target = document.createElement('aside');
    document.body.append(host, target);
    const portal = window.mountPortal(host, target);
    const portalPlaced = !!target.querySelector('[data-portal-content]');
    portal.update(target, 'packaged');
    const portalText = target.querySelector('button')?.textContent;
    portal.dispose();
    const portalRemoved = target.childNodes.length === 0;
    const lazy = window.createLazyViewFixture(host);
    lazy.mount('packed', 'initial');
    lazy.update('packed', 'latest');
    await lazy.resolve(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = host.querySelector('[data-lazy-loaded]');
    button?.click();
    const text = button?.textContent;
    lazy.dispose();
    const state = lazy.state();
    const remaining = host.childNodes.length;
    host.remove();
    target.remove();
    return { portalPlaced, portalText, portalRemoved, text, remaining, state };
  });
  assert.equal(placement.portalPlaced, true);
  assert.equal(placement.portalText, 'packaged:0');
  assert.equal(placement.portalRemoved, true);
  assert.equal(placement.text, 'latest');
  assert.equal(placement.remaining, 0);
  assert.equal(placement.state.starts, 1);
  assert.equal(placement.state.loadedMounts, 1);
  assert.equal(placement.state.loadedDisposals, 1);
  assert.deepEqual(placement.state.events, [{ id: 'packed', title: 'latest' }]);
  assert.deepEqual(placement.state.errors, []);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}
await verifyLucide(temp, run);
process.stdout.write(`Clean package consumer passed: ${temp}\n`);
