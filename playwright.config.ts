import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "3000";
const baseURL = `http://127.0.0.1:${port}`;
const referralStorePath = process.env.PIPELINE_E2E_REFERRAL_STORE_PATH
  ?? `.data/playwright/referrals-${port}.json`;
const assessmentStorePath = process.env.PIPELINE_E2E_ASSESSMENT_STORE_PATH
  ?? `.data/playwright/assessments-${port}.json`;
const residentLinkStorePath = process.env.PIPELINE_E2E_RESIDENT_LINK_STORE_PATH
  ?? `.data/playwright/resident-links-${port}.json`;
const documentStorePath = process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH
  ?? `.data/playwright/documents-${port}`;
const desktopStateStorePath = process.env.PIPELINE_E2E_DESKTOP_STATE_STORE_PATH
  ?? `.data/playwright/desktop-state-${port}.json`;
const crossBrowser = process.env.PIPELINE_CROSS_BROWSER === "true";
const desktopE2E = process.env.PIPELINE_DESKTOP_E2E === "true";
const prebuiltE2E = process.env.PIPELINE_E2E_PREBUILT === "true";
const externalE2E = process.env.PIPELINE_E2E_EXTERNAL_SERVER === "true";

process.env.PIPELINE_E2E_REFERRAL_STORE_PATH = referralStorePath;
process.env.PIPELINE_E2E_ASSESSMENT_STORE_PATH = assessmentStorePath;
process.env.PIPELINE_E2E_RESIDENT_LINK_STORE_PATH = residentLinkStorePath;
process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH = documentStorePath;
process.env.PIPELINE_E2E_DESKTOP_STATE_STORE_PATH = desktopStateStorePath;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/operational/**",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: externalE2E ? undefined : {
    command: prebuiltE2E ? "npm run start" : "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: false,
    timeout: process.env.CI ? 300_000 : 120_000,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: port,
      PIPELINE_AUTH_MODE: "mock",
      PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH: "true",
      PIPELINE_EXTRACTION_BACKEND: "mock",
      PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION: "true",
      PIPELINE_MOCK_USER_EMAIL: "playwright@pipeline.local",
      PIPELINE_MOCK_USER_NAME: "Playwright QA",
      PIPELINE_ACADEMY_OWNER_EMAILS: "playwright@pipeline.local",
      PIPELINE_ADMIN_EMAILS: "playwright@pipeline.local",
      PIPELINE_ALLOWED_EMAILS: "playwright@pipeline.local",
      PIPELINE_ALLOWED_MUTATION_ORIGINS: `${baseURL},http://localhost:${port}`,
      PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true",
      PIPELINE_REFERRAL_STORE_PATH: referralStorePath,
      PIPELINE_ASSESSMENT_STORE_PATH: assessmentStorePath,
      PIPELINE_RESIDENT_LINK_STORE_PATH: residentLinkStorePath,
      PIPELINE_LOCAL_DOCUMENT_ROOT: documentStorePath,
      PIPELINE_ENABLE_SYNTHETIC_PROFILES: "true",
      PIPELINE_WORKER_SHARED_SECRET: "playwright-worker-secret",
      NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: desktopE2E ? "true" : "false",
      PIPELINE_DESKTOP_STATE_ENABLED: desktopE2E ? "true" : "false",
      PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: desktopE2E ? "true" : "false",
      PIPELINE_DESKTOP_STATE_STORE_PATH: desktopStateStorePath,
      PIPELINE_DESKTOP_E2E: desktopE2E ? "true" : "false",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      testMatch: /responsive-accessibility\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    ...(crossBrowser ? [
      {
        name: "firefox",
        testMatch: /cross-browser-smoke\.spec\.ts/,
        use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
      },
      {
        name: "webkit",
        testMatch: /cross-browser-smoke\.spec\.ts/,
        use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
      },
    ] : []),
  ],
});
