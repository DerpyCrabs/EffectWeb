import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { platforms, hostPlatform } from './platforms.mjs';
const local = process.argv.includes('--local');
const targets = local ? [hostPlatform()] : platforms;
const compiler = JSON.parse(readFileSync('packages/compiler/package.json', 'utf8'));
const runtime = JSON.parse(readFileSync('packages/runtime/package.json', 'utf8'));
if (compiler.version !== runtime.version)
  throw new Error('Runtime and compiler versions must match.');
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
for (const directory of ['packages/runtime', 'packages/compiler']) {
  if (!existsSync(`${directory}/dist/index.js`) || !existsSync(`${directory}/dist/index.d.ts`))
    throw new Error(`Build ${directory} before packing.`);
}
mkdirSync('artifacts/packages', { recursive: true });
for (const directory of [...directories, 'packages/runtime', 'packages/compiler']) {
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
