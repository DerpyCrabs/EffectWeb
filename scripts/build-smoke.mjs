import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packages } from './packages.mjs';

const root = mkdtempSync(join(tmpdir(), 'effectweb-build-smoke-'));
const run = () =>
  spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
const digest = (directory) => {
  const hash = createHash('sha256');
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      hash.update(entry.name);
      if (entry.isDirectory()) visit(join(path, entry.name));
      else hash.update(readFileSync(join(path, entry.name)));
    }
  };
  visit(directory);
  return hash.digest('hex');
};
try {
  for (const file of [
    'scripts',
    'website/lib',
    'website/content',
    'package.json',
    'tsconfig.json',
    'tsconfig.base.json',
  ])
    cpSync(resolve(file), join(root, file), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  for (const { directory } of packages) {
    const target = join(root, 'packages', directory);
    mkdirSync(target, { recursive: true });
    for (const file of ['src', 'package.json', 'tsconfig.build.json'])
      cpSync(resolve('packages', directory, file), join(target, file), { recursive: true });
  }
  cpSync(resolve('packages/compiler/native.cjs'), join(root, 'packages/compiler/native.cjs'));
  cpSync(resolve('packages/compiler/native.d.cts'), join(root, 'packages/compiler/native.d.cts'));
  mkdirSync(join(root, 'packages/compiler/native'));
  cpSync(
    resolve('packages/compiler/native/effectweb-compiler.node'),
    join(root, 'packages/compiler/native/effectweb-compiler.node'),
  );
  const cold = run();
  assert.equal(cold.status, 0, cold.stdout + cold.stderr);
  for (const { directory, entry } of packages) {
    assert.ok(existsSync(join(root, 'packages', directory, 'dist', entry + '.js')));
    assert.ok(existsSync(join(root, 'packages', directory, 'dist', entry + '.d.ts')));
  }
  const outputs = [
    ...packages.map((p) => join(root, p.path, 'dist')),
    join(root, 'packages/runtime/docs'),
  ];
  const before = outputs.map(digest);
  mkdirSync(join(root, 'artifacts/build.lock'));
  const locked = run();
  assert.notEqual(locked.status, 0);
  assert.match(locked.stderr, /Cannot acquire build lock/);
  assert.deepEqual(outputs.map(digest), before);
  rmSync(join(root, 'artifacts/build.lock'), { recursive: true });
  // Transpilation accepts this, but declaration checking must reject it before publication.
  writeFileSync(
    join(root, 'packages/shadcn/src/build-failure.ts'),
    'export const invalid: number = "not a number";\n',
  );
  const failed = run();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout + failed.stderr, /build-failure.ts/);
  assert.deepEqual(
    outputs.map(digest),
    before,
    'Failed build modified previously complete outputs',
  );
  assert.deepEqual(readdirSync(join(root, 'artifacts')), [], 'Failed build left staging or a lock');
  console.log(
    'Cold build succeeds; late declaration failure preserves all package outputs and docs.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
