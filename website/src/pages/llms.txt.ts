import type { APIRoute } from 'astro';
import { site } from '../lib/data.mjs';

export const GET: APIRoute = async () => {
  const { pages } = await site();
  return new Response(
    '# EffectWeb\n\nImmutable Effect models and JSX with direct DOM rendering.\n\n' +
      pages.map((p) => `- [${p.title}](${p.url}): ${p.description}`).join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
