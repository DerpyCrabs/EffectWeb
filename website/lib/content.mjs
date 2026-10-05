import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApi } from './api.mjs';
import { format } from 'oxfmt';

export async function createContent(root) {
  const pages = [];
  const file = async (slug, title, description, group) => {
    pages.push({
      url: `/docs/${slug}/`,
      title,
      description,
      group,
      body: await readFile(path.join(root, 'content', slug + '.md'), 'utf8'),
      source: `website/content/${slug}.md`,
    });
  };
  const start = 'Start here';
  await file(
    'why-effectweb',
    'Why EffectWeb',
    'What EffectWeb is for, and what it does not do.',
    start,
  );
  await file(
    'getting-started',
    'Getting started',
    'Install EffectWeb and build a first app.',
    start,
  );
  await file(
    'concepts',
    'Core concepts',
    'How views, state and Effects fit together in an app.',
    start,
  );
  await file(
    'choosing-apis',
    'Which API to use',
    'Find the API for what you want to build.',
    start,
  );
  const guides = 'Guides';
  await file(
    'views',
    'Views and JSX',
    'Write views, pass children, handle events and report actions to the parent.',
    guides,
  );
  await file('lists', 'Lists', 'Render rows that keep their state when other rows change.', guides);
  await file('components', 'Components', 'Keep state for one place on the page.', guides);
  await file(
    'controllers',
    'Controllers',
    'Share state and actions across the views of a feature.',
    guides,
  );
  await file(
    'tasks',
    'Async work',
    'Run Effects under keys, choose what happens when requests overlap, and cancel safely.',
    guides,
  );
  await file('queries', 'Server data', 'Load, cache, refresh and paginate server data.', guides);
  await file(
    'forms',
    'Forms',
    'Small forms with controlled inputs, large forms with validation.',
    guides,
  );
  await file(
    'dom',
    'DOM and time',
    'Focus, measure and attach libraries to elements; show the current time.',
    guides,
  );
  await file('services', 'App setup', 'Mount the app, provide services and handle errors.', guides);
  await file(
    'testing',
    'Testing',
    'Test views, messages and request races without timing guesses.',
    guides,
  );
  const more = 'More';
  await file(
    'from-react',
    'Coming from React',
    'React patterns and their EffectWeb equivalents.',
    more,
  );
  await file(
    'integrations',
    'Integrations',
    'Routing, tables, authentication, JSON-driven UI and icons.',
    more,
  );
  await file(
    'compiler',
    'Compiler and lint',
    'Build setup, lint rules and every diagnostic code.',
    more,
  );
  const api = createApi(root);
  for (const page of api.pages) {
    const blocks = [...page.body.matchAll(/```ts\n([\s\S]*?)```/g)];
    for (const block of blocks) {
      const formatted = await format('reference.ts', block[1], {
        printWidth: 76,
        singleQuote: true,
      });
      if (formatted.errors.length) throw new Error(`Invalid declaration in ${page.title}`);
      page.body = page.body.replace(block[0], '```ts\n' + formatted.code + '```');
    }
    // Short signatures are shown directly; long ones stay collapsed.
    page.body = page.body.replace(
      /<details class="api-signature"><summary>Signature<\/summary>\n\n(```ts\n([\s\S]*?)```)\n\n<\/details>/g,
      (whole, block, code) => (code.trimEnd().split('\n').length <= 8 ? block : whole),
    );
  }
  pages.push(...api.pages);
  return pages;
}
