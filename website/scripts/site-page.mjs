import assert from 'node:assert/strict';
import { parse } from 'parse5';

/** Validate one static page and retain only the references needed for cross-page checks. */
export function indexPage(html, url) {
  const ids = new Set();
  const references = [];
  let headings = 0;
  let title = '';
  let description = false;
  let main = false;
  let styles = false;
  let entry = false;
  const text = (node) => node.value ?? (node.childNodes ?? []).map(text).join('');
  function visit(node, insidePre = false) {
    const name = node.tagName;
    if (name) {
      const attributes = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (name === 'h1') headings++;
      if (name === 'title' && !title) title = text(node);
      if (name === 'meta' && attributes.name === 'description' && attributes.content)
        description = true;
      if (name === 'main' && attributes.id === 'main') main = true;
      if (name === 'link' && attributes.rel === 'stylesheet') styles = true;
      if (name === 'script' && attributes.type === 'module' && Object.hasOwn(attributes, 'src'))
        entry = true;
      if (name === 'pre' || (attributes.class ?? '').split(/\s+/).includes('code-block'))
        assert.equal(insidePre, false, `${url}: nested code block`);
      if (Object.hasOwn(attributes, 'id')) {
        assert.equal(ids.has(attributes.id), false, `${url}: duplicate anchors`);
        ids.add(attributes.id);
      }
      if ((name === 'a' || name === 'link') && Object.hasOwn(attributes, 'href'))
        references.push(attributes.href);
      if ((name === 'script' || name === 'img') && Object.hasOwn(attributes, 'src'))
        references.push(attributes.src);
    }
    // Template content belongs to an inert document fragment, not the page's anchor tree.
    for (const child of node.childNodes ?? []) visit(child, insidePre || name === 'pre');
  }
  visit(parse(html));
  assert.equal(headings, 1, `${url}: must have one h1`);
  assert.ok(title.endsWith(' · EffectWeb'), `${url}: missing title`);
  assert.ok(description, `${url}: missing description`);
  assert.ok(main, `${url}: missing skip target`);
  assert.ok(styles, `${url}: missing production styles`);
  assert.ok(entry, `${url}: missing production entry`);
  return { ids, references };
}
