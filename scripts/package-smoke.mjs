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
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { hostPlatform } from './platforms.mjs';
import { verifyLucide } from './lucide-smoke.mjs';
import { packageFilename } from './package-filename.mjs';
import { packages } from './packages.mjs';
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
        [...packages.map(({ metadata }) => metadata.name), native].map((name) => [
          name,
          `file:${resolve('artifacts/packages', packageFilename(name, version))}`,
        ]),
      ),
      devDependencies: {
        effect: '4.0.0',
        vite: '8.3.1',
        typescript: '7.0.2',
        oxlint: '1.86.0',
        'oxlint-tsgolint': '7.0.2003',
        '@effect/tsgo': '0.47.1',
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
const { compile, lint: renderLint } = await import(
  pathToFileURL(join(temp, 'node_modules/@effectweb/compiler/dist/index.js')).href
);
assert.equal(typeof renderLint, 'function', 'Optional render lint is a public export');
const uncheckedSource = "import {view} from 'effectweb';view(m=><p>{Math.random()}</p>);";
assert.deepEqual(compile(uncheckedSource, 'unchecked.tsx').diagnostics, []);
assert.ok(renderLint(uncheckedSource, 'unchecked.tsx').some((issue) => issue.code === 'EW1003'));
assert.ok(
  renderLint(
    `import {modelOwner} from 'effectweb'; import {Effect as Fx} from 'effect';
const owner=modelOwner({busy:false});
const run=(work)=>owner.run('load',work,'replace');
const work=Fx.void.pipe(Fx.ensuring(Fx.sync(()=>owner.patch({busy:false})))); run(work);`,
    'finalizer.ts',
  ).some((issue) => issue.code === 'EW1005'),
  'Packed lint follows local wrappers and Effect aliases',
);
const bindingProbe = compile(
  `import {view, ViewBinding} from 'effectweb'; const Child=view(p=><b>{p}</b>); const Parent=view((p,send)=><ViewBinding view={Child} model={p} send={send}/>);`,
  'binding.tsx',
).code;
assert.ok(
  bindingProbe.includes('ViewBinding({'),
  'The packaged compiler must preserve the ViewBinding component call',
);
assert.ok(
  compile(
    `import {view} from 'effectweb'; const V=view(p=><button {...p}/>);`,
    'spread.tsx',
  ).code.includes('.markup('),
);
for (const name of packages.map(({ metadata }) => metadata.name)) {
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
assert.equal(runtimeExports.queryCache, undefined, 'Queries live in @effectweb/query');
assert.equal(runtimeExports.commandSlot, undefined);
assert.equal(runtimeExports.commandSlots, undefined);

assert.equal(runtimeExports.lazyView, undefined, 'Specialized APIs live in effectweb/advanced');
const runtimeManifest = JSON.parse(
  readFileSync(join(temp, 'node_modules/effectweb/package.json'), 'utf8'),
);
assert.deepEqual(Object.keys(runtimeManifest.exports).sort(), [
  '.',
  './advanced',
  './dom',
  './jsx',
  './jsx-dev-runtime',
  './jsx-runtime',
  './testing',
]);
assert.ok(existsSync(join(temp, 'node_modules/effectweb/docs/README.md')));
assert.ok(existsSync(join(temp, 'node_modules/effectweb/docs/api-runtime.md')));
const advancedExports = await import(
  pathToFileURL(join(temp, 'node_modules/effectweb/dist/advanced.js')).href
);
assert.equal(typeof advancedExports.lazyView, 'function');
assert.equal(typeof advancedExports.shareValue, 'function');
const testingExports = await import(
  pathToFileURL(join(temp, 'node_modules/effectweb/dist/testing.js')).href
);
assert.equal(typeof testingExports.renderView, 'function');
run(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-dev',
    // Keep Solid's compiler and runtime on the same RC: delegated event keys can change between RCs.
    'solid-js@2.0.0-rc.7',
    '@solidjs/compiler@2.0.0-rc.7',
    '@solidjs/babel-plugin@2.0.0-rc.7',
    '@solidjs/web@2.0.0-rc.7',
    '@solidjs/vite-plugin@3.0.0-next.39',
  ],
  temp,
);
for (const file of ['mixed-islands.jsx', 'mixed-islands.d.ts', 'mixed-effectweb.jsx'])
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
import * as AsyncResult from 'effect/reactivity/AsyncResult';
import { available, component, mount, program, view, type JSX } from 'effectweb';
import Camera from '@effectweb/lucide/icons/camera';
import type { LucideProps } from '@effectweb/lucide/types';
import AlarmCheck from '@effectweb/lucide/icons/alarm-check';
import type { IconName } from '@effectweb/lucide/dynamic';
import { mountAuthoring } from './authoringFixture';
import { mountContracts } from './contractsFixture';
import { ownershipContracts } from './ownershipFixture';
import { Editor } from './safeAuthoringFixture';
import { createLazyViewFixture } from './lazyViewFixture';
import { mountPortal } from './portalFixture';
import { mountIdentityFixture, mountRecoveryFixture } from './recoveryFixture';
import { mountInheritedContext, mountScopedRendering, checkObservationDisposal } from './scopedRenderingFixture';
import { failedRenderCleanup, mountClosingExit } from './mountLifecycleFixture';
Object.assign(window, { failedRenderCleanup, mountClosingExit, mountInheritedContext, mountScopedRendering, checkObservationDisposal, mountAuthoring, mountContracts, ownershipContracts, Editor, createLazyViewFixture, mountPortal, mountIdentityFixture, mountRecoveryFixture });
const name: IconName = 'camera';
// @ts-expect-error Unknown icon names must fail at compile time.
const badName: IconName = 'not-a-lucide-icon';
class CounterService extends Context.Service<CounterService, { increment: (value: number) => Effect.Effect<number> }>()('Counter') {}
const services = Context.make(CounterService, { increment: value => Effect.succeed(value + 1) });
const Frame = view<{ children?: JSX.Element }, never>((props, _send) => <section>{props.children}</section>);
const Counter = component({ init: (_props: {}) => ({ count: AsyncResult.initial() as AsyncResult.AsyncResult<number, never> }) }, owner => view((model) => {
  const count = available(model.count) ?? 0;
  const increment = () => owner.task('count', Effect.flatMap(CounterService, service => service.increment(count)).pipe(Effect.provideContext(services)), 'drop');
  return <Frame><button onClick={increment}><Camera size={24 + count} title="Take a photo" data-count={count} /><AlarmCheck aria-label="Alarm" />Count: {count}</button></Frame>;
}));
const source = program<{}, never>({ initial: {}, update: model => ({ model }) });
document.documentElement.dataset.snapshotFrozen = String(Object.isFrozen(source.model()));
mount(document.getElementById('app')!, Counter, source);
`,
);
writeFileSync(
  join(temp, 'jsonRenderFixture.tsx'),
  `
import { defineCatalog, type Spec } from '@json-render/core';
import { z } from 'zod';
import { Renderer, defineRegistry, setPointer, type ActionEvent } from '@effectweb/json-render';
import { schema } from '@effectweb/json-render/schema';
import { mount, program, view } from 'effectweb';
const catalog = defineCatalog(schema, { components: {
  Frame: { props: z.object({}), slots: ['default'] },
  Badge: { props: z.object({ label: z.string() }), slots: [] },
}, actions: {} });
const { registry } = defineRegistry(catalog, { components: {
  Frame: ({ children }) => <section data-json-frame>{children}</section>,
  Badge: ({ props, emit }) => <button data-json-badge onClick={() => emit('press')}>{props.label}</button>,
} });
const spec: Spec = { root: 'root', elements: {
  root: { type: 'Frame', props: {}, children: ['badge', 'hidden', 'missing', 'root'] },
  badge: { type: 'Badge', props: { label: { $state: '/label' } }, on: { press: { action: 'rename', params: { label: { $state: '/next' } } } } },
  hidden: { type: 'Badge', props: { label: 'hidden' }, visible: false },
} };
export function mountJsonRenderer(host: HTMLElement) {
  const source = program<{ state: Record<string, unknown> }, ActionEvent>({
    initial: { state: { label: 'Before', next: 'After' } },
    update: (model, action) => ({ model: { state: setPointer(model.state, '/label', action.params.label) } }),
  });
  const App = view<{ state: Record<string, unknown> }, ActionEvent>((model, send) =>
    <Renderer spec={spec} registry={registry} state={model.state} dispatch={send} />);
  const unmount = mount(host, App, source);
  return { dispose: () => { unmount(); source.dispose(); } };
}
`,
);
writeFileSync(
  join(temp, 'authoringFixture.tsx'),
  readFileSync('tests/fixtures/authoringFixture.tsx'),
);
for (const file of [
  'recoveryFixture.tsx',
  'contractsFixture.tsx',
  'scalarContract.ts',
  'ownershipFixture.tsx',
  'safeAuthoringFixture.tsx',
  'lazyViewFixture.tsx',
  'lazyViewModule.tsx',
  'portalFixture.tsx',
  'nativeEventsFixture.tsx',
  'scopedRenderingFixture.tsx',
  'mountLifecycleFixture.tsx',
]) {
  writeFileSync(join(temp, file), readFileSync(`tests/fixtures/${file}`));
}
// Route each relative runtime import to the public entry point that exports it.
const entryModules = {
  effectweb: 'runtime/src/index',
  'effectweb/advanced': 'runtime/src/advanced',
  'effectweb/testing': 'runtime/src/testing',
  'effectweb/dom': 'runtime/src/dom',
  'effectweb/jsx': 'runtime/src/jsx',
  '@effectweb/query': 'query/src/index',
};
const entryPoints = Object.entries(entryModules).map(([specifier, module]) => {
  const text = readFileSync(`packages/${module}.ts`, 'utf8');
  const names = new Set();
  for (const [, block] of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/gu))
    for (const item of block.split(','))
      names.add(
        item
          .replace(/\btype\s+/u, '')
          .split(' as ')
          .at(-1)
          .trim(),
      );
  for (const [, name] of text.matchAll(
    /^export\s+(?:declare\s+)?(?:function|const|interface|type|class|namespace)\s+(\w+)/gmu,
  ))
    names.add(name);
  return { specifier, names };
});
function packageImports(source, file) {
  return source
    .replace(
      /import\s+(type\s+)?\{([^}]*)\}\s*from\s*(['"])\.\/[A-Za-z-]+\.js\3;?/gu,
      (_match, typeOnly = '', body, quote) => {
        const groups = new Map();
        for (const item of body
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)) {
          const name = item
            .replace(/^type\s+/u, '')
            .split(' as ')[0]
            .trim();
          const entry = entryPoints.find(({ names }) => names.has(name));
          if (!entry) throw new Error(`${file}: ${name} is not exported by a public entry point`);
          groups.set(entry.specifier, [...(groups.get(entry.specifier) ?? []), item]);
        }
        return [...groups]
          .map(
            ([specifier, items]) =>
              `import ${typeOnly}{ ${items.join(', ')} } from ${quote}${specifier}${quote};`,
          )
          .join('\n');
      },
    )
    .replace(/import\s+type\s+(\w+)\s+from\s*(['"])\.\/[A-Za-z-]+\.js\2/gu, (match) => {
      throw new Error(`${file}: unsupported default import ${match}`);
    })
    .replace(/import\((['"])\.\/([A-Za-z-]+)\.js\1\)/gu, (match, quote, module) => {
      // Type queries may only name a module that is itself a public entry point.
      const entry = Object.entries(entryModules).find(([, name]) => name.endsWith(`/${module}`));
      if (!entry) throw new Error(`${file}: route ${match} through a public entry point`);
      return `import(${quote}${entry[0]}${quote})`;
    });
}
for (const file of [
  'composition.typecheck.tsx',
  'contracts.typecheck.tsx',
  'render-contract.typecheck.tsx',
  'effect-contract.typecheck.ts',
  'scoped.typecheck.tsx',
  'commands.typecheck.ts',
  'owner-task.typecheck.tsx',
  'lazy.typecheck.tsx',
  'portal.typecheck.tsx',
  'native-jsx.typecheck.ts',
]) {
  const source = packageImports(readFileSync(`packages/runtime/src/${file}`, 'utf8'), file);
  writeFileSync(join(temp, file), source);
}
for (const file of [
  'query.typecheck.ts',
  'large-project.typecheck.ts',
  'services.typecheck.ts',
  'cacheSnapshots.typecheck.ts',
]) {
  const source = packageImports(readFileSync(`packages/query/src/${file}`, 'utf8'), file);
  writeFileSync(join(temp, `query-${file}`), source);
}
writeFileSync(
  join(temp, '.oxlintrc.json'),
  JSON.stringify({
    jsPlugins: ['@effectweb/compiler/oxlint'],
    rules: { 'effectweb/valid-view': 'error', 'effectweb/render-safety': 'error' },
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
    (d) => d.code?.includes('render-safety') && d.message.includes('mutating method sort'),
  ),
  lint.stdout,
);
writeFileSync(
  lintProbe,
  `import { view } from 'effectweb';
const Good = view((model: { items: number[] }) => {
  // oxlint-disable-next-line effectweb/render-safety
  const sorted = model.items.sort();
  return <p>{sorted.length}</p>;
});`,
);
run(process.execPath, ['node_modules/oxlint/bin/oxlint', '--no-ignore', 'lint-probe.tsx'], temp);
// The lint suppression does not change the readonly type contract; remove the probe before type checks.
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
      'effectweb/identity': 'error',
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
writeFileSync(
  join(temp, 'non-array-map.tsx'),
  `import type { JSX } from 'effectweb';
const option = { map: (render: (value: string) => JSX.Element) => render('present') };
export function renderOption() {
  // oxlint-disable-next-line effectweb/identity -- This receiver is a custom non-array collection.
  return option.map(value => <b>{value}</b>);
}
`,
);
run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], temp);
// Negative type probes are checked by tsc above; syntax lint does not interpret @ts-expect-error.
const lintFiles = readdirSync(temp).filter(
  (name) => /\.tsx?$/u.test(name) && !name.includes('.typecheck.'),
);
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
  join(temp, 'json.html'),
  '<!doctype html><html><body><script type="module" src="/json-entry.ts"></script></body></html>',
);
writeFileSync(
  join(temp, 'json-entry.ts'),
  "import { mountJsonRenderer } from './jsonRenderFixture'; Object.assign(window, { mountJsonRenderer });\n",
);
writeFileSync(
  join(temp, 'vite.json.config.mjs'),
  "import { effectweb } from '@effectweb/compiler/vite'; export default { base: '/json/', plugins: [effectweb()], build: { outDir: 'json-dist', rollupOptions: { input: 'json.html' } } };\n",
);
run(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.json.config.mjs'],
  temp,
);

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

const { Effect, Context, Fiber } = await import(
  pathToFileURL(join(temp, 'node_modules/effect/dist/Effect.js')).href
).then(async (effect) => ({
  Effect: effect,
  Context: await import(pathToFileURL(join(temp, 'node_modules/effect/dist/Context.js')).href),
  Fiber: await import(pathToFileURL(join(temp, 'node_modules/effect/dist/Fiber.js')).href),
}));
const keyOwner = runtimeExports.modelOwner({});
assert.deepEqual(
  (await Effect.runPromise(keyOwner.run(['smoke', 1], Effect.succeed(42), 'replace').await)).value,
  42,
);
keyOwner.dispose();
const { queryCache, query } = await import(
  pathToFileURL(join(temp, 'node_modules/@effectweb/query/dist/index.js')).href
);
const service = Context.Service('package-smoke/service');
const cache = queryCache(Context.make(service, 'shared'));
const definition = query({ name: 'smoke', load: () => service });
assert.equal(await Effect.runPromise(cache.prefetch(definition, true)), 'shared');
assert.equal(cache.setQueryData(definition, true, 'written'), 'written');
assert.equal(
  cache.updateQueryData(definition, true, (value) => `${value}:updated`),
  'written:updated',
);
assert.equal(await Effect.runPromise(cache.prefetch(definition, true)), 'written:updated');
cache.dispose();
let releaseQuery;
let queryReleased = false;
const queryGate = new Promise((resolve) => {
  releaseQuery = resolve;
});
await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const scopedCache = yield* Effect.acquireRelease(
        Effect.sync(() => queryCache()),
        (cache) => cache.close(),
      );
      const scopedDefinition = query({
        name: 'packaged-scoped-load',
        load: () =>
          Effect.acquireRelease(Effect.succeed(1), () =>
            Effect.promise(async () => {
              await queryGate;
              queryReleased = true;
            }),
          ),
      });
      yield* scopedCache.prefetch(scopedDefinition, true);
      const retained = !queryReleased;
      const closing = Effect.runFork(scopedCache.close());
      const pending = closing.pollUnsafe() === undefined;
      releaseQuery();
      yield* Fiber.join(closing);
      assert.equal(retained, true);
      assert.equal(pending, true);
      assert.equal(
        queryReleased,
        true,
        'Query acquisition must close before the application scope',
      );
    }),
  ),
);
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (
    !/^\/(?:assets\/[\w.-]+|index.html|(?:mixed|json)\/(?:assets\/[\w.-]+|mixed.html|json.html))?$/.test(
      pathname,
    )
  ) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
    const integration = pathname.startsWith('/mixed/')
      ? 'mixed'
      : pathname.startsWith('/json/')
        ? 'json'
        : undefined;
    response.end(
      readFileSync(
        join(
          temp,
          integration ? `${integration}-dist` : 'dist',
          integration
            ? pathname.slice(integration.length + 2)
            : pathname === '/'
              ? 'index.html'
              : pathname,
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
  const jsonPage = await browser.newPage();
  jsonPage.on('pageerror', (error) => errors.push(error.message));
  await jsonPage.goto(`http://127.0.0.1:${server.address().port}/json/json.html`);
  const jsonRender = await jsonPage.evaluate(async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const mounted = window.mountJsonRenderer(host);
    const button = host.querySelector('[data-json-badge]');
    const before = button?.textContent;
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = host.querySelector('[data-json-badge]')?.textContent;
    const count = host.querySelectorAll('button').length;
    const noWrapper = host.firstElementChild?.matches('section[data-json-frame]');
    mounted.dispose();
    const disposed = host.childNodes.length === 0;
    host.remove();
    return { before, after, count, noWrapper, disposed };
  });
  assert.deepEqual(jsonRender, {
    before: 'Before',
    after: 'After',
    count: 1,
    noWrapper: true,
    disposed: true,
  });
  await jsonPage.close();
  const scoped = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const close = await window.mountInheritedContext(host);
    host.querySelector('#ambient-component').click();
    host.querySelector('#ambient-task').click();
    const labels = [...host.children].map((node) => node.textContent);
    await close();
    const rows = await window.mountScopedRendering(host);
    const before = rows.evaluations();
    rows.send({ type: 'select', id: 500 });
    const evaluated = rows.evaluations() - before;
    await rows.close();
    const disposal = await window.checkObservationDisposal(host);
    const empty = host.childNodes.length === 0;
    host.remove();
    return { labels, evaluated, disposal, empty };
  });
  assert.deepEqual(scoped, {
    labels: ['application', 'application', 'application'],
    evaluated: 2,
    disposal: { beforeClose: 1, afterClose: 1 },
    empty: true,
  });
  const lifetimes = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const failure = await window.failedRenderCleanup(host);
    const exits = [];
    for (const action of ['close', 'dispose', 'reentrant-dispose', 'failure', 'interrupt'])
      exits.push(await window.mountClosingExit(host, action));
    host.remove();
    return { failure, exits };
  });
  assert.deepEqual(lifetimes.failure, {
    result: 'Failure',
    whileClosing: ['child release started'],
    pending: true,
    after: ['child release started', 'child released', 'view dependency'],
    empty: true,
  });
  assert.deepEqual(
    lifetimes.exits,
    ['success', 'success', 'success', 'application failed', 'interrupted'].map((exit) => ({
      whileClosing: ['DOM release started'],
      bothPending: true,
      detached: true,
      after: ['DOM release started', 'DOM released', 'view released'],
      exits: [
        { owner: 'DOM', exit },
        { owner: 'view', exit },
      ],
      unsubscriptions: 1,
    })),
  );
  const recovery = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = window.mountRecoveryFixture(host);
    await Promise.resolve();
    fixture.update({ broken: true });
    await Promise.resolve();
    const failed = Boolean(host.querySelector('[data-fallback]'));
    fixture.update({ broken: false, reset: 1 });
    const recovered = Boolean(host.querySelector('[data-content]'));
    fixture.release();
    await fixture.close();
    host.remove();
    return { failed, recovered, errors: fixture.state().errors.length };
  });
  assert.deepEqual(recovery, { failed: true, recovered: true, errors: 1 });
  const identity = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const fixture = window.mountIdentityFixture(host, 'local');
    host.querySelector('[data-increment]').click();
    const old = host.querySelector('[data-editor]');
    fixture.update({ id: 'b', label: 'next' });
    const result = {
      replaced: !old.isConnected,
      text: host.querySelector('[data-increment]').textContent,
    };
    await fixture.close();
    host.remove();
    return result;
  });
  assert.deepEqual(identity, { replaced: true, text: 'b:next:0' });
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
      events: ['started', 'replacement', 'interrupted', 'replacement interrupted'],
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
// Each consumer is a full install; keep it only when a failure needs inspecting.
rmSync(temp, { recursive: true, force: true });
process.stdout.write('Clean package consumer passed\n');
