/// <reference types="node" />

import { defineConfig } from '@playwright/test';
const port = Number(process.env.EFFECTWEB_TEST_PORT ?? 4317);
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npx vp dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
