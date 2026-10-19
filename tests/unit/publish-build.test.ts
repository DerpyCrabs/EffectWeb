import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { publishBuild } from '../../scripts/publish-build.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'effectweb-build-'));
  roots.push(root);
  const directory = (name: string, content: string) => {
    const path = join(root, name);
    mkdirSync(path);
    writeFileSync(join(path, 'output'), content);
    return path;
  };
  const backup = join(root, 'backups');
  mkdirSync(backup);
  return { root, backup, directory };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
test('publishes completed outputs and retains the old outputs until cleanup', () => {
  const { directory, backup } = fixture();
  const target = directory('live', 'old');
  const staged = directory('staged', 'new');
  publishBuild([{ staged, target }], backup);
  expect(readFileSync(join(target, 'output'), 'utf8')).toBe('new');
  expect(readFileSync(join(backup, '0/output'), 'utf8')).toBe('old');
});
test('restores all previous outputs when a later replacement fails', () => {
  const { root, directory, backup } = fixture();
  const first = directory('first', 'old first');
  const second = directory('second', 'old second');
  const staged = directory('staged', 'new');
  expect(() =>
    publishBuild(
      [
        { staged, target: first },
        { staged: join(root, 'missing'), target: second },
      ],
      backup,
    ),
  ).toThrow();
  expect(readFileSync(join(first, 'output'), 'utf8')).toBe('old first');
  expect(readFileSync(join(second, 'output'), 'utf8')).toBe('old second');
});
