import { defineConfig } from 'vite-plus';
import { snapshotCompiler } from 'effectweb-compiler/vite';
export default defineConfig({
  plugins: [snapshotCompiler()],
  build: {
    outDir: 'dist-benchmark',
    emptyOutDir: true,
    rolldownOptions: { input: 'benchmarks/snapshot/index.html' },
  },
});
