import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/persona-demo",
  testIgnore: "assessor-journey.spec.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3217", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node scripts/persona-demo.mjs --port=3217 --fresh",
    url: "http://127.0.0.1:3217/api/auth/me",
    timeout: 120_000,
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
