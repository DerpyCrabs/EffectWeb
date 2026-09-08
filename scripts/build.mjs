import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { compile } from '../packages/compiler/native.cjs';

for (const name of ['compiler', 'runtime', 'lucide']) {
  const root = resolve(`packages/${name}`);
  rmSync(`${root}/dist`, { recursive: true, force: true });
  mkdirSync(`${root}/dist`, { recursive: true });
  for (const file of readdirSync(`${root}/src`)) {
    if (file.endsWith('.json')) {
      writeFileSync(`${root}/dist/${file}`, readFileSync(`${root}/src/${file}`));
      continue;
    }
    if (!/\.tsx?$/.test(file) || /\.(test|typecheck)\.tsx?$/.test(file)) continue;
    let source = readFileSync(`${root}/src/${file}`, 'utf8');
    if (/\.tsx?$/u.test(file))
      source = JSON.parse(
        compile(
          source,
          file,
          JSON.stringify({ importSource: './index.js', runtimeModule: './dom.js' }),
        ),
      ).code;
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: true,
      },
      fileName: file,
    });
    writeFileSync(`${root}/dist/${file.replace(/\.tsx?$/, '.js')}`, output.outputText);
  }
  const check = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '-p', `${root}/tsconfig.build.json`],
    { stdio: 'inherit' },
  );
  if (check.status !== 0) process.exit(check.status ?? 1);
}
await import('./build-lucide.mjs');
