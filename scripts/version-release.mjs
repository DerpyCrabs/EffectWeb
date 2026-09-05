import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { platforms } from './platforms.mjs';
const version = process.argv[2];
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error('Usage: npm run version:release -- 0.2.0');
for (const file of [
  'package.json',
  'packages/runtime/package.json',
  'packages/compiler/package.json',
  'packages/lucide/package.json',
  ...platforms.map(({ suffix }) => `packages/native-${suffix}/package.json`),
]) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.version = version;
  if (data.peerDependencies?.effectweb) data.peerDependencies.effectweb = `^${version}`;
  if (data.optionalDependencies)
    for (const name of Object.keys(data.optionalDependencies))
      data.optionalDependencies[name] = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const manifest = 'packages/compiler/native/Cargo.toml';
writeFileSync(
  manifest,
  readFileSync(manifest, 'utf8').replace(/^version = "[^"]+"/m, `version = "${version}"`),
);
const lock = 'packages/compiler/native/Cargo.lock';
writeFileSync(
  lock,
  readFileSync(lock, 'utf8').replace(
    /(name = "effectweb_compiler"\nversion = ")[^"]+/,
    `$1${version}`,
  ),
);
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['install', '--package-lock-only', '--ignore-scripts'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exitCode = result.status ?? 1;
