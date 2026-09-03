import { expect, test } from "@playwright/test";

const trainingUrl = process.env.PIPELINE_E2E_TRAINING_URL ?? "/training";
const homeUrl = trainingUrl.startsWith("http") ? new URL("/", trainingUrl).toString() : "/";

test.describe("Pipeline Learning Center", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("operator-training-e2e-initialized") === "true") return;
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("pipeline-operator-training:")) window.localStorage.removeItem(key);
        if (key.startsWith("pipeline-guided-coach:")) window.localStorage.removeItem(key);
      }
      window.sessionStorage.setItem("operator-training-e2e-initialized", "true");
    });
  });

  test("shows one full walkthrough and a concise common-task list", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const response = await page.goto(trainingUrl);
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learning Center" })).toBeVisible();
    await expect(page.getByText("Full walkthrough", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learn the complete Pipeline workflow" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Common tasks" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run your start-of-shift workflow" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect.poll(() => errors).toEqual([]);
  });

  test("starts the complete walkthrough and advances through real controls", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Start walkthrough" }).click();

    await expect(page.getByRole("dialog", { name: /Learn the complete Pipeline workflow guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start with your assigned work" })).toBeVisible();
    await expect(page.locator('[data-guide-target="my-queue"]')).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Open the referral workspace directory" })).toBeVisible();
    await page.getByLabel("Open referrals").click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Show current referral work" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("runs a short common-task walkthrough with action verification", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Start Run your start-of-shift workflow" }).click();

    await expect(page.getByRole("heading", { name: "Read your due-today, overdue, and blocked work" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Open the shared referral queue" })).toBeVisible();
    await expect(page.getByText("Use highlighted control", { exact: true })).toBeVisible();
  });

  test("persists and resumes a paused walkthrough", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Start Run your start-of-shift workflow" }).click();
    await expect(page.getByRole("heading", { name: "Read your due-today, overdue, and blocked work" })).toBeVisible();
    await page.getByRole("button", { name: "Pause tutorial" }).click();

    await page.reload();
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await page.getByRole("button", { name: /Continue where you stopped/ }).click();
    await expect(page.getByRole("heading", { name: "Read your due-today, overdue, and blocked work" })).toBeVisible();
  });

  test("is discoverable from the signed-in profile menu", async ({ page }) => {
    await page.goto(homeUrl);
    await page.getByRole("button", { name: /Open profile menu for/ }).click();
    const learningLink = page.getByRole("link", { name: /Learning Center Guided walkthroughs and common tasks/ });
    await expect(learningLink).toBeVisible();
    await learningLink.click();
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learning Center" })).toBeVisible();
  });

  test("keeps the Learning Center and guide usable at a narrow viewport", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learning Center" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "Start walkthrough" }).click();
    await expect(page.getByRole("dialog", { name: /Learn the complete Pipeline workflow guided tutorial/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

function watchBrowserErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("/_next/webpack-hmr")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function mockTrainingProgress(page: import("@playwright/test").Page) {
  let revision = 0;
  let progress = {
    version: 2,
    curriculumVersion: "2026.08.operator.3",
    role: "assessment_coordinator",
    completedActivityIds: [] as string[],
    activeModuleId: "pipeline-purpose",
    activeActivityId: "learn",
    evidence: {},
    confidence: {},
    scenarioResults: {},
    tutorialResults: {},
  };

  await page.route("**/api/training/progress", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as { progress?: typeof progress };
      if (payload.progress) progress = payload.progress;
      revision += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision, progress, updatedAt: new Date().toISOString(), persistence: "browser" }),
    });
  });
}
