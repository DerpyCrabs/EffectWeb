import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { platforms, hostPlatform } from './platforms.mjs';
import { packages } from './packages.mjs';
const local = process.argv.includes('--local');
// Local packing must use the compiler that was just built, not an older staged release.
if (local) await import('./stage-native.mjs');
const targets = local ? [hostPlatform()] : platforms;
const compiler = JSON.parse(readFileSync('packages/compiler/package.json', 'utf8'));
const runtime = JSON.parse(readFileSync('packages/runtime/package.json', 'utf8'));
for (const { metadata } of packages) {
  if (metadata.private) throw new Error(`Release package is private: ${metadata.name}`);
  if (metadata.version !== runtime.version) throw new Error(`Version mismatch: ${metadata.name}`);
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${compiler.version}`)
  throw new Error('Release tag must match package versions.');
const directories = targets.map((target) => `artifacts/native/native-${target.suffix}`);
for (const [index, directory] of directories.entries()) {
  if (!existsSync(`${directory}/compiler.node`))
    throw new Error(`Missing release binary ${targets[index].suffix}`);
  const metadata = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
  if (
    metadata.name !== `${compiler.name}-${targets[index].suffix}` ||
    metadata.version !== compiler.version
  )
    throw new Error(`Wrong artifact identity in ${directory}`);
  if (compiler.optionalDependencies[metadata.name] !== metadata.version)
    throw new Error(`Incorrect optional dependency ${metadata.name}`);
}
for (const { path: directory, entry } of packages) {
  if (
    !existsSync(`${directory}/dist/${entry}.js`) ||
    !existsSync(`${directory}/dist/${entry}.d.ts`)
  )
    throw new Error(`Build ${directory} before packing.`);
}
mkdirSync('artifacts/packages', { recursive: true });
for (const directory of [...directories, ...packages.map(({ path }) => path)]) {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'pack',
      resolve(directory),
      '--ignore-scripts',
      '--pack-destination',
      resolve('artifacts/packages'),
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
