import { readFile } from 'node:fs/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';

export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const repo = 'https://github.com/DerpyCrabs/EffectWeb';
const mark = '<span class="brand-mark" aria-hidden="true">≋</span>';
const arrow = '<span aria-hidden="true">↗</span>';

export async function documentation(root) {
  const highlighter = await createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: ['tsx', 'typescript', 'javascript', 'json', 'bash', 'html', 'css'],
  });
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    highlight(code, lang) {
      lang = lang.split(/\s+/)[0];
      // `// @hide` lines are type-checked by test:docs but not shown.
      code = code
        .split('\n')
        .filter((line) => !line.trimEnd().endsWith('// @hide'))
        .join('\n');
      const language = { ts: 'typescript', js: 'javascript', sh: 'bash' }[lang] ?? lang;
      const highlighted = highlighter.codeToHtml(code.trimEnd(), {
        lang: highlighter.getLoadedLanguages().includes(language) ? language : 'text',
        themes: { light: 'github-light', dark: 'github-dark' },
      });
      return `<div class="code-block"><div class="code-toolbar"><span>${escape(lang || 'text')}</span><button class="copy-code" type="button" aria-label="Copy code">Copy</button></div>${highlighted}</div>`;
    },
  });
  md.renderer.rules.fence = (tokens, index) =>
    md.options.highlight(tokens[index].content, tokens[index].info.trim(), '');
  md.renderer.rules.heading_open = (tokens, idx, _options, env, self) => {
    const title = tokens[idx + 1].content.replaceAll('`', '');
    const base = slug(title);
    env.ids ??= new Map();
    const count = (env.ids.get(base) ?? 0) + 1;
    env.ids.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    tokens[idx].attrSet('id', id);
    if (tokens[idx].tag === 'h2') env.headings?.push({ id, title });
    if (tokens[idx].tag === 'h3') env.subheadings?.push({ id, title });
    return self.renderToken(tokens, idx, _options);
  };
  const code = (value, lang = 'tsx') => md.render(`\n\`\`\`${lang}\n${value}\n\`\`\`\n`);
  const { createContent } = await import('./content.mjs');
  const pages = await createContent(root);
  const version = JSON.parse(
    await readFile(path.join(root, '../packages/runtime/package.json'), 'utf8'),
  ).version;
  const header = (section) =>
    `<header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="EffectWeb home">${mark}EffectWeb</a><nav class="top-nav" aria-label="Main navigation"><a ${section === 'docs' ? 'aria-current="page"' : ''} href="/docs/getting-started/">Docs</a><a ${section === 'api' ? 'aria-current="page"' : ''} href="/docs/api-runtime/">API reference</a></nav><div class="header-actions"><button class="search-trigger" type="button" aria-label="Search documentation"><span>⌕</span> <span class="search-label">Search docs</span><kbd>⌘ K</kbd></button><a class="github-link" href="${repo}">GitHub ${arrow}</a><button class="theme-toggle icon-button" aria-label="Toggle color theme" title="Toggle color theme">◐</button><button class="menu-toggle icon-button" aria-label="Open navigation" aria-expanded="false">☰</button></div></div></header>`;
  const footer = `<footer class="site-footer"><a class="brand" href="/">${mark}EffectWeb</a><div><a href="${repo}">GitHub ${arrow}</a><a href="${repo}/blob/main/LICENSE">MIT License</a></div></footer>`;
  const dialog = `<dialog class="search-dialog" aria-labelledby="search-title"><form method="dialog" class="search-top"><label id="search-title" for="search-input">Search documentation</label><button aria-label="Close search">Esc</button></form><input id="search-input" type="search" autocomplete="off" placeholder="Try “search as you type” or “modelOwner”…"><div id="search-status" role="status" aria-live="polite"></div><div id="search-results"></div><div class="search-hint">Type to find guides and API entries.</div></dialog>`;
  const fontFiles = [
    'inter/files/inter-latin-wght-normal.woff2',
    'jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  ];
  const fontLinks = (production) =>
    fontFiles
      .map(
        (file) =>
          `<link rel="preload" href="${production ? '/assets/' + path.basename(file) : '/@fs' + path.resolve(root, '../node_modules/@fontsource-variable', file)}" as="font" type="font/woff2" crossorigin>`,
      )
      .join('');
  const shell = (title, description, body, section = 'docs') =>
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(description)}"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f8f9f6"><title>${escape(title)} · EffectWeb</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><script>try{const t=localStorage.getItem('effectweb-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{}</script><!--fonts--><link rel="stylesheet" href="/src/style.css"></head><body><a class="skip-link" href="#main">Skip to content</a>${header(section)}${body}${footer}${dialog}<script type="module" src="/src/main.ts"></script></body></html>`;
  const counter = `import { component, view } from 'effectweb';

const Counter = component<{}, { count: number }>(
  { init: () => ({ count: 0 }) },
  view((model, patch) => (
    <button onClick={() => patch({ count: model.count + 1 })}>
      Count: {model.count}
    </button>
  )),
);`;
  const home = `<main id="main" class="landing">
    <section class="hero">
      <div class="hero-copy">
        <h1>Web interfaces,<br><em>built with Effect.</em></h1>
        <p class="hero-description">Build interactive browser apps with TypeScript, JSX and Effect. Give overlapping requests an explicit policy, tie background work to a component’s lifetime, and keep edits with the right list item—all with immutable state.</p>
        <div class="hero-actions"><a class="button primary" href="/docs/getting-started/">Get started <span>→</span></a><a class="button text-button" href="/docs/why-effectweb/">Why EffectWeb →</a></div>
      </div>
      <div class="hero-example"><div class="example-caption"><span class="file-label">counter.tsx</span></div>${code(counter)}<p class="example-footnote">The click handler patches the state. The view runs again with the new value.</p></div>
    </section>
    <section class="principles" aria-label="Main ideas">
      <article><h2>See what drives the screen</h2><p>Views read immutable inputs. Keep unchanged data as the same object so child views can skip work; change state through explicit actions.</p><a href="/docs/concepts/">Core concepts →</a></article>
      <article><h2>Decide which request wins</h2><p>Replace an earlier search, ignore duplicate submits, or queue saves. A component’s work stops when it leaves the page; controllers give shared work an explicit lifetime.</p><a href="/docs/tasks/">Async work →</a></article>
      <article><h2>Rows keep their identity</h2><p>Reorder a list without moving focus, drafts or running work to another item. Keys follow the data; state that must survive removal belongs in the parent.</p><a href="/docs/lists/">Lists →</a></article>
    </section>
    <p class="landing-limit">Best suited to interactive apps such as editors, dashboards and chat clients. APIs are still evolving; server rendering and hydration are not provided. <a href="/docs/why-effectweb/">What it does and does not do →</a></p>
  </main>`;
  const routes = new Map([
    [
      '/',
      shell(
        'Web interfaces with Effect',
        'EffectWeb is a client-side UI framework for immutable Effect models, familiar JSX, and direct DOM rendering.',
        home,
        'home',
      ),
    ],
  ]);
  const search = [];
  const groups = [...new Set(pages.map((p) => p.group))];
  for (const [index, page] of pages.entries()) {
    const env = { headings: [], subheadings: [] };
    const html = md.render(page.body, env);
    const navigation = groups
      .map(
        (group) =>
          `<details class="nav-group" ${group === page.group || group !== 'API reference' ? 'open' : ''}><summary>${escape(group)}</summary>${pages
            .filter((p) => p.group === group)
            .map(
              (p) =>
                `<a href="${p.url}" ${p.url === page.url ? 'aria-current="page"' : ''}>${escape(p.title)}</a>`,
            )
            .join('')}</details>`,
      )
      .join('');
    const next = pages[index + 1];
    const previous = pages[index - 1];
    const body = `<div class="docs-layout"><aside class="docs-sidebar" aria-label="Documentation navigation"><div class="sidebar-version">Documentation <span>v${version}</span></div>${navigation}</aside><main id="main" class="doc-main"><div class="doc-breadcrumb">${escape(page.group)} <span>/</span> ${escape(page.title)}</div><article class="prose"><h1>${escape(page.title)}</h1><p class="doc-description">${escape(page.description)}</p>${html}</article><nav class="page-navigation" aria-label="Adjacent pages">${previous ? `<a href="${previous.url}"><span>← Previous</span>${escape(previous.title)}</a>` : '<span></span>'}${next ? `<a href="${next.url}"><span>Next →</span>${escape(next.title)}</a>` : ''}</nav><div class="doc-meta"><a href="${repo}/blob/main/${page.source ?? 'website/content'}">View source ${arrow}</a></div></main><aside class="on-this-page"><h2>On this page</h2><nav>${env.headings.map((h) => `<a href="#${h.id}">${escape(h.title)}</a>`).join('')}</nav></aside></div>`;
    routes.set(
      page.url,
      shell(page.title, page.description, body, page.group === 'API reference' ? 'api' : 'docs'),
    );
    search.push({
      title: page.title,
      description: page.description,
      url: page.url,
      group: page.group,
      text: page.body.replace(/[`#*|]/g, '').slice(0, 35000),
    });
    for (const h of [...env.headings, ...env.subheadings])
      search.push({
        title: h.title,
        description: `${page.title} · ${page.group}`,
        url: page.url + '#' + h.id,
        group: page.group,
        text: h.title,
      });
  }
  routes.set(
    '/404.html',
    shell(
      'Page not found',
      'Find your way back to the EffectWeb documentation.',
      '<main id="main" class="not-found"><span class="eyebrow">404</span><h1>Page not found</h1><p>Find an API with search, or start with the documentation.</p><a class="button primary" href="/docs/getting-started/">Go to the docs →</a></main>',
    ),
  );
  const searchJson = JSON.stringify(search);
  const textAssets = new Map(
    pages.map((p) => [p.url + 'index.md', `# ${p.title}\n\n${p.description}\n\n${p.body}`]),
  );
  textAssets.set(
    '/llms.txt',
    '# EffectWeb\n\nImmutable Effect models and JSX with direct DOM rendering.\n\n' +
      pages.map((p) => `- [${p.title}](${p.url}): ${p.description}`).join('\n'),
  );
  return {
    name: 'effectweb-documentation',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (textAssets.has(pathname)) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(textAssets.get(pathname));
          return;
        }
        if (pathname === '/search.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(searchJson);
          return;
        }
        if (pathname.startsWith('/@') || (pathname.includes('.') && !pathname.endsWith('.html')))
          return next();
        const key = pathname.endsWith('/') || pathname === '/404.html' ? pathname : pathname + '/';
        const page = routes.get(key);
        res.statusCode = page ? 200 : 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        try {
          res.end(
            await server.transformIndexHtml(
              pathname,
              (page ?? routes.get('/404.html')).replace('<!--fonts-->', fontLinks(false)),
            ),
          );
        } catch (e) {
          next(e);
        }
      });
    },
    generateBundle(_options, bundle) {
      const css = Object.values(bundle)
        .filter((a) => a.fileName.endsWith('.css'))
        .map((a) => `<link rel="stylesheet" href="/${a.fileName}">`)
        .join('');
      for (const [url, html] of routes)
        this.emitFile({
          type: 'asset',
          fileName:
            url === '/'
              ? 'index.html'
              : url === '/404.html'
                ? '404.html'
                : url.slice(1) + 'index.html',
          source: html
            .replace('<!--fonts-->', fontLinks(true))
            .replace('<link rel="stylesheet" href="/src/style.css">', css)
            .replace('src="/src/main.ts"', 'src="/assets/site.js"'),
        });
      this.emitFile({ type: 'asset', fileName: 'search.json', source: searchJson });
      for (const [url, source] of textAssets)
        this.emitFile({ type: 'asset', fileName: url.slice(1), source });
    },
  };
}
