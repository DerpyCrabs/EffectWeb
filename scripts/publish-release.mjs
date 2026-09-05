import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { platforms } from './platforms.mjs';
import { packageFilename } from './package-filename.mjs';
const { version } = JSON.parse(readFileSync('packages/runtime/package.json', 'utf8'));
const names = [
  ...platforms.map((platform) => `@effectweb/compiler-${platform.suffix}`),
  'effectweb',
  '@effectweb/compiler',
  '@effectweb/lucide',
];
const tag = version.includes('-') ? 'next' : 'latest';
// Check the complete artifact set before any irreversible publish.
for (const name of names) {
  const file = `artifacts/packages/${packageFilename(name, version)}`;
  if (!existsSync(file)) throw new Error(`Missing tarball: ${name}`);
  // Scoped and unscoped names can produce the same filename. Inspect the actual package.
  const manifest = spawnSync('tar', ['-xOf', file, 'package/package.json'], { encoding: 'utf8' });
  if (manifest.status !== 0) throw new Error(`Cannot inspect ${file}: ${manifest.stderr}`);
  const metadata = JSON.parse(manifest.stdout);
  if (metadata.name !== name || metadata.version !== version)
    throw new Error(`Wrong package in ${file}: ${metadata.name}@${metadata.version}`);
}
for (const name of names) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const existing = spawnSync(npm, ['view', `${name}@${version}`, 'version', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (existing.status === 0 && JSON.parse(existing.stdout) === version) {
    process.stdout.write(`${name}@${version} already published; skipping.\n`);
    continue;
  }
  if (existing.status !== 0 && !existing.stderr.includes('E404'))
    throw new Error(`Could not check ${name}: ${existing.stderr}`);
  const result = spawnSync(
    npm,
    [
      'publish',
      `artifacts/packages/${packageFilename(name, version)}`,
      '--access',
      'public',
      '--tag',
      tag,
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
