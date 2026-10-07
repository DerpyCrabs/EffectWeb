import type { APIRoute } from 'astro';
import { site } from '../lib/data.mjs';

export const GET: APIRoute = async () => {
  const { search } = await site();
  return new Response(JSON.stringify(search), { headers: { 'Content-Type': 'application/json' } });
};
