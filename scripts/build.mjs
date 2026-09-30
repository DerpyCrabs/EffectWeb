import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { compile } from '../packages/compiler/native.cjs';

import { packages } from './packages.mjs';

// Linked consumers keep serving the previous build while this one is written; each package's
// dist is replaced in one rename once its JavaScript is complete.
const staged = [];
for (const { directory: name } of packages) {
  const root = resolve(`packages/${name}`);
  const dist = `${root}/dist.next`;
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  staged.push(root);
  for (const file of readdirSync(`${root}/src`)) {
    if (file.endsWith('.json')) {
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
for (const root of staged) {
  rmSync(`${root}/dist`, { recursive: true, force: true });
  renameSync(`${root}/dist.next`, `${root}/dist`);
}

// Declarations are the slow step. Packages only read each other's declarations, so after
// the two packages the others depend on, the rest are checked together.
const declarations = (name) =>
  new Promise((done, fail) => {
    const check = spawn(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '-p', resolve(`packages/${name}/tsconfig.build.json`)],
      { stdio: 'inherit' },
    );
    check.on('error', fail);
    check.on('exit', (status) =>
      status === 0 ? done() : fail(new Error(`Declarations failed for ${name} (${status}).`)),
    );
  });
const foundations = ['compiler', 'runtime', 'query'];
for (const name of foundations) await declarations(name);
await Promise.all(
  packages
    .map(({ directory }) => directory)
    .filter((name) => !foundations.includes(name))
    .map(declarations),
);
await import('./build-lucide.mjs');
await import('./build-antd-icons.mjs');
