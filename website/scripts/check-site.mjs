import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const output = fileURLToPath(new URL('../dist/', import.meta.url));
const window = new Window();
const documents = new Map();
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      const document = new window.DOMParser().parseFromString(html, 'text/html');
      const relative = path.relative(output, file);
      const url = relative === 'index.html' ? '/' : '/' + relative.replace(/index\.html$/, '');
      documents.set(url, document);
      assert.equal(document.querySelectorAll('h1').length, 1, `${url}: must have one h1`);
      assert.ok(document.title.endsWith(' · EffectWeb'), `${url}: missing title`);
      assert.ok(
        document.querySelector('meta[name="description"]')?.getAttribute('content'),
        `${url}: missing description`,
      );
      assert.ok(document.querySelector('main#main'), `${url}: missing skip target`);
      assert.equal(
        document.querySelectorAll('pre pre, pre .code-block').length,
        0,
        `${url}: nested code block`,
      );
      const ids = Array.from(document.querySelectorAll('[id]'), (node) => node.id);
      assert.equal(new Set(ids).size, ids.length, `${url}: duplicate anchors`);
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
        target.getElementById(decodeURIComponent(url.hash.slice(1))),
        `${current}: missing anchor ${value}`,
      );
  } else {
    const file = path.join(output, decodeURIComponent(url.pathname));
    assert.ok((await stat(file).catch(() => null))?.isFile(), `${current}: missing file ${value}`);
  }
  links++;
}
for (const [url, doc] of documents) {
  for (const element of doc.querySelectorAll('a[href], link[href], script[src], img[src]'))
    await checkLink(element.getAttribute('href') ?? element.getAttribute('src'), url);
  assert.ok(doc.querySelector('link[rel="stylesheet"]'), `${url}: missing production styles`);
  assert.ok(doc.querySelector('script[src="/assets/site.js"]'), `${url}: missing production entry`);
}
const search = JSON.parse(await readFile(path.join(output, 'search.json'), 'utf8'));
assert.ok(search.length > 150, 'Expected searchable guides and API symbols');
for (const item of search) await checkLink(item.url, '/');
assert.ok(
  search.some((item) => item.title === 'ownerOf'),
  'Missing core API in search',
);
assert.ok(
  search.some((item) => item.title === 'QueryCache'),
  'Missing cache methods in search',
);
await window.happyDOM.close();
console.log(
  `Verified ${documents.size} HTML pages, ${links} internal references, and ${search.length} search entries.`,
);
