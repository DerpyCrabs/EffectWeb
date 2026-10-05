import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createContent } from './content.mjs';

// The site's pages as plain Markdown for the `effectweb` package, so agents and people read the
// documentation that matches the installed version from `node_modules/effectweb/docs`.
const markdown = (body) =>
  body
    // `// @hide` lines are type-checked by test:docs but not shown on the site either.
    .split('\n')
    .filter((line) => !line.trimEnd().endsWith('// @hide'))
    .join('\n')
    .replace(/^(```\w+) check$/gm, '$1')
    .replace(/(\]\(|href=")\/docs\/([a-z-]+)\/(#[^)"]*)?/g, '$1$2.md$3')
    .replace(/<p class="api-source"><a href="([^"]+)">Source<\/a><\/p>/g, '[Source]($1)')
    .replace(/<details class="api-signature"><summary>(.*?)<\/summary>\n\n/g, (_, summary) =>
      summary === 'Signature' ? '' : `${summary}:\n\n`,
    )
    .replace(/\n\n<\/details>/g, '');

export async function writePackageDocs(website, target) {
  const pages = await createContent(website);
  const staged = `${target}.next`;
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });
  const index = [
    '# EffectWeb documentation',
    '',
    'The documentation of this EffectWeb version. Read the pages under "Start here" first; the API reference lists every export.',
  ];
  let group;
  for (const page of pages) {
    const name = page.url.split('/').at(-2) + '.md';
    writeFileSync(
      path.join(staged, name),
      `# ${page.title}\n\n${page.description}\n\n${markdown(page.body).trim()}\n`,
    );
    if (page.group !== group) {
      group = page.group;
      index.push('', `## ${group}`, '');
    }
    index.push(`- [${page.title}](${name}): ${page.description}`);
  }
  writeFileSync(path.join(staged, 'README.md'), index.join('\n') + '\n');
  rmSync(target, { recursive: true, force: true });
  renameSync(staged, target);
}
