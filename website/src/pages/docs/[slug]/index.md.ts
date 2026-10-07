import type { APIRoute } from 'astro';
import { site } from '../../../lib/data.mjs';

export async function getStaticPaths() {
  const { pages } = await site();
  return pages.map((page) => ({ params: { slug: page.slug }, props: { page } }));
}
// The Markdown companion of each page, for readers that want plain text.
export const GET: APIRoute = ({ props }) => {
  const page = props.page as { title: string; description: string; body: string };
  return new Response(`# ${page.title}\n\n${page.description}\n\n${page.body}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
