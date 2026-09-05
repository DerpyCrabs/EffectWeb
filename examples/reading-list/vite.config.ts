import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import { snapshotCompiler } from 'effectweb-compiler/vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [snapshotCompiler()],
  build: { outDir: 'dist', emptyOutDir: true },
});
