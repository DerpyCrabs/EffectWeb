import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostPlatform } from './platforms.mjs';
import { packageFilename } from './package-filename.mjs';
import { buildItems, serveRegistry, writeRegistry } from './shadcn-registry.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
async function run(command, args, cwd = root) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });
}
const registryDirectory = process.env.EFFECTWEB_REGISTRY_DIRECTORY;
if (!registryDirectory) writeRegistry();
await run(process.execPath, ['scripts/pack-release.mjs', '--local']);
const temp = mkdtempSync(join(tmpdir(), 'effectweb-registry-consumer-'));
const version = JSON.parse(
  readFileSync(join(root, 'packages/runtime/package.json'), 'utf8'),
).version;
const names = [
  'effectweb',
  '@effectweb/compiler',
  '@effectweb/base-ui',
  '@effectweb/lucide',
  `@effectweb/compiler-${hostPlatform().suffix}`,
];
const local = Object.fromEntries(
  names
    .filter((name) => name === 'effectweb' || name === '@effectweb/compiler')
    .map((name) => [
      name,
      `file:${join(root, 'artifacts/packages', packageFilename(name, version))}`,
    ]),
);
const families = buildItems()
  .filter(
    (item) =>
      item.type === 'registry:ui' &&
      (!process.env.EFFECTWEB_REGISTRY_ITEM || item.name === process.env.EFFECTWEB_REGISTRY_ITEM),
  )
  .map((item) => item.name);
// The CLI reinstalls exact version specs. A temporary scoped npm endpoint maps
// those specs to our packed checkout, exercising its real dependency installer.
const packed = new Map(
  names.map((name) => {
    const filename = packageFilename(name, version);
    const tarball = readFileSync(join(root, 'artifacts/packages', filename));
    const directory = name === 'effectweb' ? 'runtime' : name.slice('@effectweb/'.length);
    const metadataPath = name.includes('compiler-')
      ? join(root, 'artifacts/native', `native-${hostPlatform().suffix}`, 'package.json')
      : join(root, 'packages', directory, 'package.json');
    return [name, { filename, tarball, metadata: JSON.parse(readFileSync(metadataPath, 'utf8')) }];
  }),
);
const npmServer = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
  const artifact = [...packed.values()].find((item) => path === `tarballs/${item.filename}`);
  if (artifact) {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.end(artifact.tarball);
    return;
  }
  const entry = packed.get(path);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  const metadata = {
    ...entry.metadata,
    dist: {
      tarball: `http://127.0.0.1:${npmServer.address().port}/tarballs/${entry.filename}`,
      integrity: `sha512-${createHash('sha512').update(entry.tarball).digest('base64')}`,
    },
  };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(
    JSON.stringify({
      name: path,
      'dist-tags': { latest: version },
      versions: { [version]: metadata },
    }),
  );
});
await new Promise((resolve, reject) => {
  npmServer.once('error', reject);
  npmServer.listen(0, '127.0.0.1', resolve);
});
const server = await serveRegistry(0, registryDirectory);
try {
  const port = server.address().port;
  const write = (file, content) => {
    mkdirSync(dirname(join(temp, file)), { recursive: true });
    writeFileSync(join(temp, file), content);
  };
  write('.npmrc', `@effectweb:registry=http://127.0.0.1:${npmServer.address().port}/\n`);
  write(
    'package.json',
    JSON.stringify(
      {
        name: 'effectweb-registry-consumer',
        private: true,
        type: 'module',
        dependencies: { ...local, effect: '4.0.0' },
        devDependencies: {
          vite: '8.3.1',
          typescript: '7.0.2',
          tailwindcss: '4.3.3',
          '@tailwindcss/vite': '4.3.3',
        },
      },
      null,
      2,
    ),
  );
  write(
    'components.json',
    JSON.stringify(
      {
        $schema: 'https://ui.shadcn.com/schema.json',
        style: 'base-nova',
        rsc: false,
        tsx: true,
        tailwind: { config: '', css: 'src/styles.css', baseColor: 'neutral', cssVariables: true },
        aliases: {
          components: '@/components',
          utils: '@/lib/utils',
          ui: '@/components/ui',
          lib: '@/lib',
          hooks: '@/hooks',
        },
        registries: { '@effectweb': `http://127.0.0.1:${port}/{name}.json` },
      },
      null,
      2,
    ),
  );
  write(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          jsx: 'react-jsx',
          jsxImportSource: 'effectweb',
          noUncheckedSideEffectImports: true,
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      },
      null,
      2,
    ),
  );
  write('src/styles.css', "@import 'tailwindcss';\n");
  write('src/vite-env.d.ts', '/// <reference types="vite/client" />\n');
  write(
    'index.html',
    '<html><head><title>Registry consumer</title></head><body><script type="module" src="/src/main.ts"></script></body></html>',
  );
  write(
    'vite.config.mjs',
    "import { effectweb } from '@effectweb/compiler/vite';\nimport tailwindcss from '@tailwindcss/vite';\nexport default { resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } }, plugins: [effectweb(), tailwindcss()] };\n",
  );
  await run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], temp);
  // Resolve the pinned CLI from the workspace, while --cwd selects the clean consumer.
  await run(npx, [
    '--no-install',
    'shadcn',
    'add',
    ...families.map((name) => `@effectweb/${name}`),
    '@effectweb/theme',
    '--yes',
    '--cwd',
    temp,
  ]);
  for (const name of families)
    assert.ok(readFileSync(join(temp, `src/components/ui/${name}.tsx`), 'utf8').length);
  for (const name of names)
    assert.equal(
      JSON.parse(readFileSync(join(temp, 'node_modules', name, 'package.json'), 'utf8')).version,
      version,
    );
  for (const [name, directory, entry] of [
    ['effectweb', 'runtime', 'dist/index.js'],
    ['@effectweb/base-ui', 'base-ui', 'dist/index.js'],
    ['@effectweb/lucide', 'lucide', 'dist/icons/check.js'],
    ['@effectweb/compiler', 'compiler', 'dist/vite.js'],
  ])
    assert.deepEqual(
      readFileSync(join(temp, 'node_modules', name, entry)),
      readFileSync(join(root, 'packages', directory, entry)),
      `${name} must be installed from this checkout`,
    );
  write(
    'src/styles.css',
    "@import 'tailwindcss';\n@import '../styles/effectweb-shadcn-theme.css';\n",
  );
  write(
    'src/main.ts',
    "import './styles.css';\n" +
      families
        .map((name, index) => `import * as family${index} from '@/components/ui/${name}';`)
        .join('\n') +
      `\nObject.assign(window, { registryFamilies: [${families.map((_name, index) => `family${index}`).join(', ')}] });\n`,
  );
  await run(npx, ['--offline', 'tsc', '--noEmit'], temp);
  await run(npx, ['--offline', 'vite', 'build'], temp);
  const assets = readdirSync(join(temp, 'dist/assets'));
  const css = assets
    .filter((file) => file.endsWith('.css'))
    .map((file) => readFileSync(join(temp, 'dist/assets', file), 'utf8'))
    .join('\n');
  assert.ok(
    css.includes('--color-background') || css.includes('var(--background)'),
    'Theme tokens must reach production CSS',
  );
  assert.ok(css.includes('dialog[data-slot]'), 'Unlayered native overlay rules must survive');
  assert.ok(
    css.includes('.bg-primary'),
    'Copied component classes must generate Tailwind utilities',
  );
  console.log(
    `Registry smoke passed: ${families.length} copied UI families, 4 helpers, theme, TypeScript and Vite/Tailwind production build.`,
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await new Promise((resolve, reject) =>
    npmServer.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(temp, { recursive: true, force: true });
}
