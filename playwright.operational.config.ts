import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "3197";
const baseURL = `http://127.0.0.1:${port}`;
const storeRoot = `.data/playwright-operational/${port}`;
const allowedEmails = [
  "ops-admin@pipeline.local",
  "admissions@pipeline.local",
  "assessor-a@pipeline.local",
  "assessor-b@pipeline.local",
  "viewer@pipeline.local",
].join(",");

process.env.PIPELINE_E2E_REFERRAL_STORE_PATH ??= `${storeRoot}/referrals.json`;
process.env.PIPELINE_E2E_ASSESSMENT_STORE_PATH ??= `${storeRoot}/assessments.json`;
process.env.PIPELINE_E2E_RESIDENT_LINK_STORE_PATH ??= `${storeRoot}/resident-links.json`;
process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH ??= `${storeRoot}/documents`;
process.env.PIPELINE_E2E_DESKTOP_STATE_STORE_PATH ??= `${storeRoot}/desktop-state.json`;
process.env.PIPELINE_E2E_NOTE_LAB_STORE_PATH ??= `${storeRoot}/note-lab.json`;

export default defineConfig({
  testDir: "./tests/e2e/operational",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start",
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: false,
    timeout: process.env.CI ? 300_000 : 120_000,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: port,
      PIPELINE_OPERATIONAL_E2E: "true",
      PIPELINE_AUTH_MODE: "headers",
      PIPELINE_TRUSTED_GATEWAY: "true",
      PIPELINE_ALLOWED_EMAILS: allowedEmails,
      PIPELINE_ALLOWED_MUTATION_ORIGINS: `${baseURL},http://localhost:${port}`,
      PIPELINE_EXTRACTION_BACKEND: "mock",
      PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION: "true",
      PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true",
      PIPELINE_ALLOW_LOCAL_ASSESSMENT_STORE: "true",
      PIPELINE_ALLOW_LOCAL_RESIDENT_LINK_STORE: "true",
      PIPELINE_REFERRAL_STORE_PATH: process.env.PIPELINE_E2E_REFERRAL_STORE_PATH,
      PIPELINE_ASSESSMENT_STORE_PATH: process.env.PIPELINE_E2E_ASSESSMENT_STORE_PATH,
      PIPELINE_RESIDENT_LINK_STORE_PATH: process.env.PIPELINE_E2E_RESIDENT_LINK_STORE_PATH,
      PIPELINE_NOTE_LAB_STORE_PATH: process.env.PIPELINE_E2E_NOTE_LAB_STORE_PATH,
      PIPELINE_LOCAL_DOCUMENT_ROOT: process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH,
      PIPELINE_ENABLE_SYNTHETIC_PROFILES: "true",
      PIPELINE_WORKER_SHARED_SECRET: process.env.PIPELINE_WORKER_SHARED_SECRET ?? "operational-worker-secret",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
