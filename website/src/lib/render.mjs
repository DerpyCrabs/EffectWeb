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

/** Markdown-it with Shiki highlighting, heading ids and the site's code block toolbar. */
export async function createRenderer() {
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
  return {
    /** Render a page body; returns its HTML and the h2/h3 headings for the contents list. */
    page(body) {
      const env = { headings: [], subheadings: [] };
      const html = md.render(body, env);
      return { html, headings: env.headings, subheadings: env.subheadings };
    },
    /** Render one code block. */
    code: (value, lang = 'tsx') => md.render(`\n\`\`\`${lang}\n${value}\n\`\`\`\n`),
  };
}
