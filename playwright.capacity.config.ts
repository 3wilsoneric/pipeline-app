import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/capacity', workers: 1, fullyParallel: false, retries: 0,
  timeout: 3 * 60 * 60 * 1000, expect: { timeout: 30_000 },
  outputDir: '.data/capacity-20260919/results',
  reporter: [['list'], ['json', { outputFile: '.data/capacity-20260919/playwright.json' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4177', headless: true, trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node scripts/capacity-local-server.mjs',
    url: 'http://127.0.0.1:4177/api/health/live', reuseExistingServer: false, timeout: 60_000,
  },
});
