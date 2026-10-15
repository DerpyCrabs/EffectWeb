import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { indexPage } from './site-page.mjs';
import { verifyRegistry } from './registry-files.mjs';

const output = fileURLToPath(new URL('../dist/', import.meta.url));
const documents = new Map();
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      const relative = path.relative(output, file);
      const url = relative === 'index.html' ? '/' : '/' + relative.replace(/index\.html$/, '');
      documents.set(url, indexPage(html, url));
    }
  }
}
await walk(output);
assert.ok(documents.size >= 20, 'Expected a complete multi-page documentation site');
let links = 0;
async function checkLink(value, current) {
  if (!value || /^(?:https?:|mailto:|data:)/.test(value)) return;
  const url = new URL(value, 'https://effectweb.test' + current);
  const target = documents.get(url.pathname);
  if (target) {
    if (url.hash)
      assert.ok(
        target.ids.has(decodeURIComponent(url.hash.slice(1))),
        `${current}: missing anchor ${value}`,
      );
  } else {
    const file = path.join(output, decodeURIComponent(url.pathname));
    assert.ok((await stat(file).catch(() => null))?.isFile(), `${current}: missing file ${value}`);
  }
  links++;
}
for (const [url, doc] of documents) {
  for (const reference of doc.references) await checkLink(reference, url);
}
const search = JSON.parse(await readFile(path.join(output, 'search.json'), 'utf8'));
assert.ok(search.length > 150, 'Expected searchable guides and API symbols');
for (const item of search) await checkLink(item.url, '/');
assert.ok(
  search.some((item) => item.title === 'ComponentOwner'),
  'Missing core API in search',
);
assert.ok(
  search.some((item) => item.title === 'QueryCache'),
  'Missing cache methods in search',
);
console.log(
  `Verified ${documents.size} HTML pages, ${links} internal references, and ${search.length} search entries.`,
);

// Published registry URLs must contain exactly the generated source-copy payloads.
const registry = fileURLToPath(new URL('../../packages/shadcn/registry/', import.meta.url));
const registryCount = await verifyRegistry(registry, path.join(output, 'r'));
console.log(`Verified ${registryCount} published registry JSON files.`);
