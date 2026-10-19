import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { compile } from '../packages/compiler/native.cjs';

import { packages } from './packages.mjs';
import { publishBuild } from './publish-build.mjs';

// No live output is replaced until JavaScript, generated assets, types and docs succeed.
mkdirSync('artifacts', { recursive: true });
const lock = resolve('artifacts/build.lock');
try {
  mkdirSync(lock);
} catch (cause) {
  throw new Error(`Cannot acquire build lock ${lock}; another build may be running.`, { cause });
}
const staging = mkdtempSync(resolve('artifacts/build-'));
let retainBackups = false;
try {
  for (const { directory: name } of packages) {
    const root = resolve(`packages/${name}`);
    const dist = `${staging}/${name}/dist`;
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    for (const file of readdirSync(`${root}/src`)) {
      if (file.endsWith('.json') || file.endsWith('.css')) {
        writeFileSync(`${dist}/${file}`, readFileSync(`${root}/src/${file}`));
        continue;
      }
      if (!/\.tsx?$/.test(file) || /\.(test|typecheck)\.tsx?$/.test(file)) continue;
      let source = readFileSync(`${root}/src/${file}`, 'utf8');
      if (/\.tsx?$/u.test(file))
        source = JSON.parse(
          compile(
            source,
            file,
            JSON.stringify(
              [
                'query',
                'json-render',
                'tanstack-router',
                'tanstack-form',
                'tanstack-table',
                'keycloak',
                'shadcn',
                'base-ui',
              ].includes(name)
                ? { importSource: 'effectweb', runtimeModule: 'effectweb/dom' }
                : { importSource: './index.js', runtimeModule: './dom.js' },
            ),
          ),
        ).code;
      const output = transformSync(source, {
        target: 'es2022',
        supported: { 'import-attributes': true },
        format: 'esm',
        loader: 'ts',
        sourcefile: file,
        tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      });
      writeFileSync(`${dist}/${file.replace(/\.tsx?$/, '.js')}`, output.code);
    }
  }

  const run = (args) =>
    new Promise((done, fail) => {
      const child = spawn(process.execPath, args, { stdio: 'inherit' });
      child.on('error', fail);
      child.on('exit', (status) =>
        status === 0 ? done() : fail(new Error(`${args[0]} failed (${status}).`)),
      );
    });
  await run(['scripts/build-lucide.mjs', `${staging}/lucide/dist`]);
  await run(['scripts/build-antd-icons.mjs', `${staging}/antd-icons/dist`]);

  const paths = {};
  for (const { directory, metadata } of packages) {
    for (const [entry, value] of Object.entries(metadata.exports ?? {})) {
      if (typeof value !== 'object' || !value.types) continue;
      const name = metadata.name + (entry === '.' ? '' : entry.slice(1));
      paths[name] = [resolve(staging, directory, value.types)];
    }
  }
  // Resolve sibling packages against this build, never against an older installed dist.
  const order = ['compiler', 'runtime', 'query', 'base-ui', 'lucide', 'antd-icons'];
  for (const name of [
    ...order,
    ...packages.map((p) => p.directory).filter((name) => !order.includes(name)),
  ]) {
    const ownPaths = { ...paths };
    const pkg = packages.find((p) => p.directory === name);
    for (const [entry, value] of Object.entries(pkg.metadata.exports ?? {})) {
      if (typeof value !== 'object' || !value.types) continue;
      const source = resolve(
        `packages/${name}`,
        value.types.replace('./dist/', './src/').replace(/\.d\.ts$/, '.ts'),
      );
      if (name === 'runtime')
        ownPaths[pkg.metadata.name + (entry === '.' ? '' : entry.slice(1))] = [source];
    }
    const config = `${staging}/${name}/tsconfig.json`;
    writeFileSync(
      config,
      JSON.stringify({
        extends: resolve(`packages/${name}/tsconfig.build.json`),
        compilerOptions: { outDir: `${staging}/${name}/dist`, paths: ownPaths },
      }),
    );
    await run(['node_modules/typescript/bin/tsc', '-p', config]);
  }
  const { writePackageDocs } = await import('../website/lib/package-docs.mjs');
  await writePackageDocs(resolve('website'), `${staging}/runtime/docs`, staging);
  const backupRoot = `${staging}/backups`;
  mkdirSync(backupRoot);
  try {
    publishBuild(
      [
        ...packages.map(({ directory }) => ({
          staged: `${staging}/${directory}/dist`,
          target: resolve(`packages/${directory}/dist`),
        })),
        { staged: `${staging}/runtime/docs`, target: resolve('packages/runtime/docs') },
      ],
      backupRoot,
    );
  } catch (error) {
    retainBackups = error instanceof AggregateError;
    throw error;
  }
} finally {
  if (!retainBackups) rmSync(staging, { recursive: true, force: true });
  rmSync(lock, { recursive: true, force: true });
}
