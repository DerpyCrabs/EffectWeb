import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createContent } from '../../lib/content.mjs';
import { createRenderer } from './render.mjs';

export const repo = 'https://github.com/DerpyCrabs/EffectWeb';
// Injected by astro.config.mjs: the website directory.
// eslint-disable-next-line no-undef
const root = __SITE_ROOT__;

// Content and the API reference are generated once per build (the reference runs tsc).
let loading;
export function site() {
  return (loading ??= load());
}
async function load() {
  const [renderer, pages, manifest] = await Promise.all([
    createRenderer(),
    createContent(root),
    readFile(path.join(root, '../packages/runtime/package.json'), 'utf8'),
  ]);
  const version = JSON.parse(manifest).version;
  const groups = [...new Set(pages.map((p) => p.group))];
  const search = [];
  const rendered = pages.map((page, index) => {
    const { html, headings, subheadings } = renderer.page(page.body);
    search.push({
      title: page.title,
      description: page.description,
      url: page.url,
      group: page.group,
      text: page.body.replace(/[`#*|]/g, '').slice(0, 35000),
    });
    for (const h of [...headings, ...subheadings])
      search.push({
        title: h.title,
        description: `${page.title} · ${page.group}`,
        url: page.url + '#' + h.id,
        group: page.group,
        text: h.title,
      });
    return {
      ...page,
      slug: page.url.split('/').at(-2),
      html,
      headings,
      previous: pages[index - 1],
      next: pages[index + 1],
    };
  });
  return { pages: rendered, groups, search, version, code: renderer.code };
}
