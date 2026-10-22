import { afterEach, expect, it } from 'vitest';
import { registryItemSchema, registrySchema } from 'shadcn/schema';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildItems,
  checkRegistry,
  collectDependencies,
  renderRegistry,
  serveRegistry,
  toConsumerSource,
  writeRegistry,
} from '../../scripts/shadcn-registry.mjs';
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
it('rewrites JS sibling and helper imports and splits class variant imports', () => {
  const source = toConsumerSource(`import { cn as classes, cva, type VariantProps } from './cn.js';
import type { Native } from "./types.js";
import { Button } from './button.js';
import { overlayAdapter } from './adapter.js';
import { place } from './placement.js';`);
  expect(source).toContain("import { cn as classes } from '@/lib/utils';");
  expect(source).toContain("import { cva, type VariantProps } from 'class-variance-authority';");
  for (const path of ['lib/types', 'lib/adapter', 'lib/placement', 'components/ui/button'])
    expect(source).toContain(`@/${path}`);
  expect(toConsumerSource("import type { VariantProps as Props } from './cn.js';")).toBe(
    "import type { VariantProps as Props } from 'class-variance-authority';",
  );
});
it('derives sorted unique npm specs and namespaced registry dependencies', () => {
  expect(
    collectDependencies(
      `import { A } from '@effectweb/base-ui/dialog';
import { B } from '@effectweb/base-ui';
import Icon from '@effectweb/lucide/icons/check';
import { view } from 'effectweb';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { cva } from 'class-variance-authority';`,
      {
        '@effectweb/base-ui': '0.11.0',
        '@effectweb/lucide': '0.11.0',
        'class-variance-authority': '0.7.1',
      },
    ),
  ).toEqual({
    dependencies: [
      '@effectweb/base-ui@0.11.0',
      '@effectweb/lucide@0.11.0',
      'class-variance-authority',
    ],
    registryDependencies: ['@effectweb/button', '@effectweb/utils'],
  });
});
it.each(['missing', '@effectweb/missing', '@other/missing/subpath'])(
  'rejects undeclared import %s',
  (name) => {
    expect(() => collectDependencies(`import { x } from '${name}';`)).toThrow(
      `undeclared dependency "${name}"`,
    );
  },
);
it('detects side effect imports, reexports, dynamic imports and theme dependencies', () => {
  for (const source of [
    "import 'missing';",
    "export { x } from 'missing';",
    "const x = import('missing');",
  ])
    expect(() => collectDependencies(source)).toThrow('undeclared dependency');
  expect(collectDependencies("import { view } from 'effectweb';")).toEqual({});
  expect(buildItems().find((item) => item.name === 'theme')?.dependencies).toEqual([
    'tw-animate-css',
  ]);
});
it('emits exactly one UI item per family plus the five shared items', () => {
  const items = buildItems();
  const families = readdirSync('packages/shadcn/src')
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => file.slice(0, -4))
    .sort();
  expect(families).toHaveLength(55);
  expect(
    items
      .filter((item) => item.type === 'registry:ui')
      .map((item) => item.name)
      .sort(),
  ).toEqual(families);
  expect(items.filter((item) => item.type === 'registry:lib').map((item) => item.name)).toEqual([
    'utils',
    'types',
    'adapter',
    'placement',
  ]);
  expect(items.find((item) => item.name === 'utils')?.files[0]?.content).toBe(
    "export { cn } from 'cn';\n",
  );
  expect(items.find((item) => item.name === 'adapter')?.dependencies).toContain(
    `@effectweb/base-ui@${(JSON.parse(readFileSync('packages/base-ui/package.json', 'utf8')) as { version: string }).version}`,
  );
  expect(items.find((item) => item.name === 'theme')?.files[0]?.target).toBe(
    '~/styles/effectweb-shadcn-theme.css',
  );
});
it('strips file content from the catalog but retains it in each item', () => {
  const rendered = renderRegistry();
  expect(rendered.size).toBe(61);
  expect(rendered.get('registry.json')).not.toContain('"content":');
  expect(rendered.get('registry.json')).toContain('"name": "effectweb"');
  expect(rendered.get('button.json')).toContain('"content":');
});
it('detects missing, stale and nested orphaned files and repairs them', () => {
  const directory = mkdtempSync(join(tmpdir(), 'effectweb-registry-test-'));
  temporary.push(directory);
  expect(checkRegistry(directory)).toHaveLength(61);
  writeRegistry(directory);
  expect(checkRegistry(directory)).toEqual([]);
  writeFileSync(join(directory, 'button.json'), '{}');
  mkdirSync(join(directory, 'old'));
  writeFileSync(join(directory, 'old/orphan.json'), '{}');
  expect(checkRegistry(directory)).toEqual(['stale: button.json', 'orphaned: old/orphan.json']);
  writeRegistry(directory);
  expect(checkRegistry(directory)).toEqual([]);
});
it('serves JSON and rejects unknown and traversal paths', async () => {
  const server = await serveRegistry(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listening port');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/button.json`);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.text()).toBe(renderRegistry().get('button.json'));
    for (const path of ['/unknown.json', '/%2e%2e/package.json'])
      expect((await fetch(base + path)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('conforms to the pinned upstream CLI schemas', () => {
  for (const item of buildItems())
    expect(registryItemSchema.safeParse(item).success, item.name).toBe(true);
  expect(registrySchema.safeParse(JSON.parse(renderRegistry().get('registry.json')!)).success).toBe(
    true,
  );
});

it('rejects malformed request targets and survives file read errors', async () => {
  const { createConnection } = await import('node:net');
  const directory = mkdtempSync(join(tmpdir(), 'effectweb-registry-http-'));
  temporary.push(directory);
  mkdirSync(join(directory, 'directory.json'));
  writeFileSync(join(directory, 'ok.json'), '{}');
  const server = await serveRegistry(0, directory);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const response = await new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port: address.port }, () =>
        socket.end('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'),
      );
      let text = '';
      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString();
      });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
    expect(response).toContain('400 Bad Request');
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/directory.json`)).status).toBe(500);
    expect((await fetch(`${base}/missing.json`)).status).toBe(404);
    expect(await (await fetch(`${base}/ok.json`)).text()).toBe('{}');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
