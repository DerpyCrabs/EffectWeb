import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// Content lives in website/content and lib/; the bundled build code needs the real path.
const root = fileURLToPath(new URL('.', import.meta.url));

// Static documentation site. Pages are prerendered; the client router swaps pages in place and
// prefetches links on hover, so navigation does not reload the document.
export default defineConfig({
  site: 'https://effectweb.dev',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  server: { host: '0.0.0.0', port: 4310 },
  devToolbar: { enabled: false },
  vite: { define: { __SITE_ROOT__: JSON.stringify(root) } },
});
