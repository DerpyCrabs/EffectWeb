import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import { documentation } from './lib/site.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  plugins: [await documentation(root)],
  server: { host: '0.0.0.0', port: 4310, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { site: `${root}/src/main.ts`, style: `${root}/src/style.css` },
      output: { entryFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});
