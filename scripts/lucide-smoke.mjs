import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

/** Runs against installed tarballs, never workspace imports. */
export async function verifyLucide(temp, run) {
  const installed = (name) => pathToFileURL(join(temp, 'node_modules', name)).href;
  const catalogue = await import(installed('@effectweb/lucide/dist/index.js'));
  const { loadIcon, isIconName, iconNames, IconLoadError } = await import(
    installed('@effectweb/lucide/dist/dynamic.js')
  );
  const Effect = await import(installed('effect/dist/Effect.js'));
  assert.equal(await Effect.runPromise(loadIcon('camera')), catalogue.Camera);
  assert.equal(await Effect.runPromise(loadIcon('alarm-check')), catalogue.AlarmClockCheck);
  assert.equal(catalogue.AlarmCheck, catalogue.AlarmClockCheck);
  assert.ok(isIconName('camera'));
  assert.ok(!isIconName('constructor'));
  assert.ok(!isIconName('__proto__'));
  const failure = await Effect.runPromise(Effect.flip(loadIcon('constructor')));
  assert.ok(failure instanceof IconLoadError);
  assert.equal(failure.iconName, 'constructor');
  for (const name of iconNames) {
    // Verify every wildcard export and declaration, including aliases.
    assert.ok(
      readFileSync(join(temp, `node_modules/@effectweb/lucide/dist/icons/${name}.d.ts`), 'utf8'),
    );
    assert.equal(
      typeof (await import(installed(`@effectweb/lucide/dist/icons/${name}.js`))).default.build,
      'function',
    );
  }
  writeFileSync(
    join(temp, 'lucide.html'),
    '<!doctype html><div id="app"></div><script type="module" src="/lucide-audit.js"></script>',
  );
  writeFileSync(
    join(temp, 'lucide.config.mjs'),
    "export default { build: { outDir: 'lucide-dist', rolldownOptions: { input: 'lucide.html' } } };\n",
  );
  writeFileSync(
    join(temp, 'lucide-audit.js'),
    `
import * as icons from '@effectweb/lucide';
import * as data from '@effectweb/lucide/data';
import { buildLucideIconElement, buildLucideSvg, buildLucideDataUri } from '@effectweb/lucide/build';
import { Scope } from 'effectweb/dom';
import { domMount } from 'effectweb/mount';
const check = (value, message) => { if (!value) throw new Error(message); };
const shape = element => [element.localName,
  Object.fromEntries([...element.attributes].filter(a => a.name !== 'key').map(a => [a.name, a.value]).sort()),
  [...element.children].map(shape)];
const host = document.getElementById('app');
const seen = new Map();
let aliases = 0;
for (const [name, datum] of Object.entries(data)) {
  if (name === 'icons') continue;
  const icon = icons[name];
  check(typeof icon?.build === 'function', 'Missing named export: ' + name);
  if (seen.has(datum.name)) { check(seen.get(datum.name) === icon, 'Alias identity: ' + name); aliases++; continue; }
  seen.set(datum.name, icon);
  const scope = new Scope({}, () => {});
  icon.build(scope, host, null);
  const svg = host.querySelector('svg');
  const expected = buildLucideIconElement(document, datum);
  check(svg.namespaceURI === 'http://www.w3.org/2000/svg', 'SVG namespace: ' + name);
  check(svg.getAttribute('aria-hidden') === 'true', 'Decorative accessibility: ' + name);
  check(JSON.stringify([...svg.children].map(shape)) === JSON.stringify([...expected.children].map(shape)), 'Geometry mismatch: ' + name);
  for (const attr of expected.attributes) check(svg.getAttribute(attr.name) === attr.value, 'Root attribute: ' + name + ':' + attr.name);
  check(!svg.querySelector('[key]'), 'VDOM key leaked: ' + name);
  scope.dispose(); host.replaceChildren();
}
check(buildLucideSvg(data.Camera).includes('<svg'), 'Raw SVG builder');
check(buildLucideDataUri(data.Camera).startsWith('data:image/svg+xml'), 'Data URI builder');
let clicks = 0, captures = 0, mounts = 0, disposals = 0;
const props = { size: 32, title: 'Photo', absoluteStrokeWidth: true, class: 'custom',
  classList: { active: true }, style: { color: 'red' }, 'data-state': 'ready',
  onClick: () => { clicks++; }, onClickCapture: () => { captures++; },
  use: domMount(() => { mounts++; return () => { disposals++; }; }) };
const scope = new Scope(props, () => {});
icons.Camera.build(scope, host, null);
await Promise.resolve();
const svg = host.querySelector('svg'), path = svg.querySelector('path');
check(mounts === 1, 'Mount callback');
check(svg.getAttribute('aria-hidden') === null && svg.getAttribute('role') === 'img', 'Title accessibility');
check(svg.querySelector('title').textContent === 'Photo', 'Title text');
check(path.getAttribute('vector-effect') === 'non-scaling-stroke', 'Absolute stroke');
svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
check(clicks === 1 && captures === 1, 'Native events');
const observer = new MutationObserver(() => {});
observer.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true });
scope.set({ ...props });
check(observer.takeRecords().length === 0, 'Equal props caused DOM mutations');
scope.set({ size: '1em', color: 'blue', strokeWidth: 0, 'aria-label': 'New camera',
  class: 'next', style: { backgroundColor: 'blue' }, onClick: () => { clicks += 10; } });
check(host.querySelector('svg') === svg && svg.querySelector('path') === path, 'Update replaced geometry');
check(svg.getAttribute('width') === '1em' && svg.getAttribute('stroke') === 'blue' && svg.getAttribute('stroke-width') === '0', 'Updated presentation');
check(!svg.hasAttribute('data-state') && !svg.querySelector('title'), 'Removed props');
check(!svg.classList.contains('active') && svg.classList.contains('next'), 'Class cleanup');
check(svg.style.color === '' && svg.style.backgroundColor === 'blue', 'Style cleanup');
check(!path.hasAttribute('vector-effect'), 'Stroke scaling reset');
svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
check(clicks === 11 && captures === 1, 'Fresh and removed handlers');
check(disposals === 1, 'Mount cleanup after removal');
scope.set({});
check(svg.getAttribute('aria-hidden') === 'true' && !svg.hasAttribute('role'), 'Accessibility reset');
scope.dispose();
svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
check(clicks === 11, 'Listener cleanup');
observer.disconnect();
window.lucideResult = { canonical: seen.size, aliases, exports: Object.keys(icons).length };
`,
  );
  run(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--config', 'lucide.config.mjs'],
    temp,
  );
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!/^\/(?:assets\/[\w.-]+|lucide.html)?$/.test(pathname))
      return response.writeHead(404).end();
    try {
      response.setHeader(
        'Content-Type',
        pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
      );
      response.end(
        readFileSync(join(temp, 'lucide-dist', pathname === '/' ? 'lucide.html' : pathname)),
      );
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page
      .waitForFunction(() => window.lucideResult, { timeout: 30_000 })
      .catch((error) => {
        throw new Error(errors.join('\n') || error.message);
      });
    assert.deepEqual(errors, []);
    const result = await page.evaluate(() => window.lucideResult);
    assert.ok(result.canonical > 1500, 'Catalogue unexpectedly small');
    process.stdout.write(
      `Lucide packed browser audit: ${JSON.stringify(result)}; ${iconNames.length} import paths verified.\n`,
    );
  } finally {
    await browser?.close();
    server.close();
  }
}
