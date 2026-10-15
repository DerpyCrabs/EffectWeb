import { defineConfig } from '@playwright/test';
const port = Number(process.env.EFFECTWEB_PERFORMANCE_PORT ?? 4393);
export default defineConfig({
  testDir: '../browser',
  testMatch: 'performance-regression.spec.ts',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../../artifacts/performance-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx vp build --config tests/performance/vite.config.ts && npx vp preview --outDir artifacts/performance --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/tests/performance/`,
    reuseExistingServer: false,
    cwd: '../..',
  },
});
