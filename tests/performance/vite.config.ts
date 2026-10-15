import { defineConfig } from 'vite-plus';
import base from '../../vite.config';
export default defineConfig({
  ...base,
  build: {
    outDir: 'artifacts/performance',
    emptyOutDir: true,
    rolldownOptions: { input: 'tests/performance/index.html' },
  },
});
