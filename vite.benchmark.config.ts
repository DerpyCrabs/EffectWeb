import { defineConfig } from 'vite-plus';
import { effectweb } from '@effectweb/compiler/vite';
export default defineConfig({
  plugins: [effectweb()],
  build: {
    outDir: 'dist-benchmark',
    emptyOutDir: true,
    rolldownOptions: { input: 'benchmarks/snapshot/index.html' },
  },
});
