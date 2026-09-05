import { spawnSync } from 'node:child_process';
import { copyFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('packages/compiler/native');
const result = spawnSync(
  'cargo',
  [
    'build',
    '--manifest-path',
    `${directory}/Cargo.toml`,
    '--release',
    '--locked',
    '--message-format=json-render-diagnostics',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
if (result.error)
  throw new Error(
    'Framework development requires Rust 1.96+ and Cargo. Published packages do not.',
    { cause: result.error },
  );
if (result.status !== 0) throw new Error(`Cargo failed (${result.status}).`);
const artifact = result.stdout
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .findLast(
    (message) =>
      message.reason === 'compiler-artifact' && message.target?.name === 'effectweb_compiler',
  );
const library = artifact?.filenames.find((file) => /\.(so|dylib|dll)$/.test(file));
if (!library) throw new Error('Cargo did not report the compiler library.');
const target = `${directory}/effectweb-compiler.node`;
copyFileSync(library, `${target}.tmp`);
renameSync(`${target}.tmp`, target);
