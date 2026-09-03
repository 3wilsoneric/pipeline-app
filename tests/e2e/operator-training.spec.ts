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

  test("shows ranked task tiles and expands a task into its clickpath", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const response = await page.goto(trainingUrl);
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "I want to..." })).toBeVisible();
    const taskTiles = page.locator('section[aria-label="Pipeline tasks"] > div > button');
    await expect(taskTiles.first()).toHaveAccessibleName("Open Complete an assessment");
    await expect(page.getByRole("button", { name: "Open full Pipeline workflow overview" })).toBeVisible();

    await page.getByRole("button", { name: "Open Complete an assessment" }).click();
    await expect(page.getByRole("heading", { name: "Complete an assessment" })).toBeVisible();
    await expect(page.getByLabel("Clickpath: Workspaces, then Referral, then Assessment, then Begin, then Sections, then Sign")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start guided walkthrough: Complete an assessment" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("starts an assessor workflow and advances through real controls", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Find my assigned work" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find my assigned work" }).click();

    await expect(page.getByRole("dialog", { name: /Review assigned assessment work guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review your assigned work" })).toBeVisible();
    await expect(page.locator('[data-guide-target="my-queue"]')).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await page.getByLabel("Open referrals").click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Show current work" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("runs a common-task walkthrough with action verification", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Find and reopen a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find and reopen a referral" }).click();

    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await expect(page.getByText("Use highlighted control", { exact: true })).toBeVisible();
  });

  test("persists and resumes a paused walkthrough", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Find and reopen a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find and reopen a referral" }).click();
    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await page.getByRole("button", { name: "Pause tutorial" }).click();

    await page.reload();
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await page.getByRole("button", { name: /Continue where you stopped/ }).click();
    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
  });

  test("is discoverable from the signed-in profile menu", async ({ page }) => {
    await page.goto(homeUrl);
    await page.getByRole("button", { name: /Open profile menu for/ }).click();
    const learningLink = page.getByRole("link", { name: /Learning Center Guided walkthroughs and common tasks/ });
    await expect(learningLink).toBeVisible();
    await learningLink.click();
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "I want to..." })).toBeVisible();
  });

  test("shows the full referral-to-handoff workflow", async ({ page }) => {
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open full Pipeline workflow overview" }).click();

    const preview = page.getByRole("dialog", { name: "Full Pipeline walkthrough" });
    await expect(preview).toBeVisible();
    const previewBox = await preview.boundingBox();
    const viewport = page.viewportSize();
    expect(previewBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(previewBox!.x).toBeGreaterThanOrEqual(0);
    expect(previewBox!.y).toBeGreaterThanOrEqual(0);
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(viewport!.height);
    await expect(preview.getByRole("heading", { name: "Find the work that needs attention" })).toBeVisible();
    await preview.getByRole("button", { name: "Next step" }).click();
    await expect(preview.getByRole("heading", { name: "Create the referral workspace" })).toBeVisible();
    await preview.getByRole("button", { name: "Close full walkthrough" }).click();
    await expect(preview).toBeHidden();
  });

  test("keeps the Learning Center and guide usable at a narrow viewport", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "I want to..." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "Open full Pipeline workflow overview" }).click();
    const preview = page.getByRole("dialog", { name: "Full Pipeline walkthrough" });
    await expect(preview.getByRole("button", { name: "Next step" })).toBeInViewport();
    await preview.getByRole("button", { name: "Close full walkthrough" }).click();

    await page.getByRole("button", { name: "Open Find and reopen a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find and reopen a referral" }).click();
    await expect(page.getByRole("dialog", { name: /Find and reopen a referral guided tutorial/ })).toBeVisible();
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
