import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import { effectweb } from '@effectweb/compiler/vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [effectweb()],
  build: { outDir: 'dist', emptyOutDir: true },
});
