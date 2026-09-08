import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { effectweb } from './vite.js';

const directories: string[] = [];
function consumer(config?: object) {
  const root = mkdtempSync(join(tmpdir(), 'effectweb-vite-test-'));
  directories.push(root);
  writeFileSync(
    join(root, 'app.tsx'),
    "import { view } from 'effectweb'; export const Counter = view((model: { count: number }) => <b>{model.count}</b>);",
  );
  if (config) writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(config));
  return root;
}
function buildConsumer(root: string) {
  return build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [effectweb()],
    build: {
      write: false,
      lib: { entry: join(root, 'app.tsx'), formats: ['es'] },
      rolldownOptions: { external: /^effectweb(?:\/|$)/u },
    },
  });
}
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('builds a consumer without a TypeScript project configuration', async () => {
  await expect(buildConsumer(consumer())).resolves.toBeDefined();
});

it('leaves project settings and unrelated type errors to the consumer tooling', async () => {
  const root = consumer({
    compilerOptions: { strict: false, noUncheckedIndexedAccess: false },
    include: ['*.ts', '*.tsx'],
  });
  writeFileSync(join(root, 'unrelated.ts'), 'export const label: string = 123;');
  await expect(buildConsumer(root)).resolves.toBeDefined();
});

it('still rejects invalid EffectWeb view code without project-level checks', async () => {
  const root = consumer();
  writeFileSync(
    join(root, 'app.tsx'),
    "import { view } from 'effectweb'; export const Bad = view((model: { items: number[] }) => <b>{model.items.sort().length}</b>);",
  );
  await expect(buildConsumer(root)).rejects.toThrow(/mutating method sort/u);
});
