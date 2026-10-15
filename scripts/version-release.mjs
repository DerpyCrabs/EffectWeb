import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { platforms } from './platforms.mjs';
import { packages } from './packages.mjs';
import { releaseManifest } from './release-manifest.mjs';
const version = process.argv[2];
if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error('Usage: npm run version:release -- 0.2.0');
const releaseNames = new Set([
  ...packages.map(({ metadata }) => metadata.name),
  ...platforms.map(({ suffix }) => `@effectweb/compiler-${suffix}`),
]);
for (const file of [
  'package.json',
  ...packages.map(({ path }) => `${path}/package.json`),
  ...platforms.map(({ suffix }) => `packages/native-${suffix}/package.json`),
]) {
  const data = releaseManifest(JSON.parse(readFileSync(file, 'utf8')), version, releaseNames);
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
// Registry items pin the EffectWeb packages they install, so regenerate them for the new version.
const registry =
  result.status === 0
    ? spawnSync(process.execPath, ['scripts/shadcn-registry.mjs'], { stdio: 'inherit' })
    : result;
process.exitCode = registry.status ?? 1;
