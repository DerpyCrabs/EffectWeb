import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyRegistry } from '../../website/scripts/registry-files.mjs';
import { expect, it } from 'vitest';
import { indexPage } from '../../website/scripts/site-page.mjs';
const page = (content: string) =>
  `<!doctype html><html><head><title>Test · EffectWeb</title><meta name="description" content="Test"><link rel="stylesheet" href="/style.css"><script type="module" src="/entry.js"></script></head><body><main id="main"><h1>Test</h1>${content}</main></body></html>`;
it('indexes links and anchors without retaining syntax-highlighted DOM objects', () => {
  const result = indexPage(
    page(
      '<h2 id="api">API</h2><a href="/docs/#api">Go</a><pre><code><span>let a = 1</span></code></pre>',
    ),
    '/',
  );
  expect([...result.ids]).toEqual(['main', 'api']);
  expect(result.references).toEqual(['/style.css', '/entry.js', '/docs/#api']);
});
it('keeps duplicate anchor, nested code and production asset validation', () => {
  expect(() => indexPage(page('<h2 id="main">Duplicate</h2>'), '/')).toThrow('duplicate anchors');
  expect(() => indexPage(page('<pre><span class="code-block">nested</span></pre>'), '/')).toThrow(
    'nested code block',
  );
  expect(() => indexPage(page('').replace('type="module"', 'type="text/plain"'), '/')).toThrow(
    'missing production entry',
  );
  expect(() => indexPage(page('').replace('rel="stylesheet"', 'rel="alternate"'), '/')).toThrow(
    'missing production styles',
  );
  expect(() => indexPage(page('<h1>Second</h1>'), '/')).toThrow('must have one h1');
});

it('decodes HTML entities in anchor and link attributes', () => {
  const result = indexPage(page('<h2 id="a&amp;b">Encoded</h2><a href="#a%26b">Jump</a>'), '/');
  expect(result.ids.has('a&b')).toBe(true);
  expect(result.references).toContain('#a%26b');
});

it('preserves anchors after a quoted greater-than sign', () => {
  expect(indexPage(page('<h2 title="a > b" id="real">Heading</h2>'), '/').ids.has('real')).toBe(
    true,
  );
});
it('does not index markup inside raw-text elements', () => {
  expect(
    indexPage(page('<textarea><a href="/missing">Text</a></textarea>'), '/').references,
  ).not.toContain('/missing');
});
it('does not index inert template content', () => {
  const result = indexPage(
    page('<template><h2 id="ghost">Heading</h2><a href="/missing">Link</a></template>'),
    '/',
  );
  expect(result.ids.has('ghost')).toBe(false);
  expect(result.references).not.toContain('/missing');
});

it('compares complete registry inventories and payload bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'effectweb-registry-'));
  const source = path.join(directory, 'source');
  const published = path.join(directory, 'published');
  try {
    await mkdir(path.join(source, 'nested'), { recursive: true });
    await mkdir(path.join(published, 'nested'), { recursive: true });
    await writeFile(path.join(source, 'nested/item.json'), Buffer.from([0xff]));
    await writeFile(path.join(published, 'nested/item.json'), Buffer.from([0xff]));
    expect(await verifyRegistry(source, published)).toBe(1);
    await writeFile(path.join(published, 'unexpected.json'), '{}');
    await expect(verifyRegistry(source, published)).rejects.toThrow('inventory differs');
    await rm(path.join(published, 'unexpected.json'));
    await writeFile(path.join(published, 'nested/item.json'), Buffer.from([0xfe]));
    await expect(verifyRegistry(source, published)).rejects.toThrow('payload differs');
    await rm(path.join(published, 'nested/item.json'));
    await expect(verifyRegistry(source, published)).rejects.toThrow('inventory differs');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
