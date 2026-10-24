import { defineConfig } from '@playwright/test';
const runId = Date.now();
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', channel: 'msedge', trace: 'retain-on-failure' },
  webServer: [
    {
      command: `npm run dev:worker -- --persist-to .wrangler/browser-tests/${runId} --var AUTH_INSTANCE:e2e-${runId}`,
      url: 'http://127.0.0.1:8787/api/setup-state',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'npm run dev:ui',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
