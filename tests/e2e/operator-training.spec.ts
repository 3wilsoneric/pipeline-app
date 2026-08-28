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

  test("completes a mastery sequence and preserves progress after reload", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const response = await page.goto(trainingUrl);
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practice the work before it counts." })).toBeVisible();
    await expect(page.getByText("Pipeline Learning Center", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "My path" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "What Pipeline governs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Understand the workflow" })).toBeVisible();

    await page.getByRole("button", { name: "Record and continue" }).click();
    await expect(page.getByRole("heading", { name: "Follow the safe path" })).toBeVisible();
    await page.getByRole("button", { name: "Record and continue" }).click();
    await expect(page.getByRole("heading", { name: "Trace the workflow" })).toBeVisible();
    const practiceComplete = page.getByRole("button", { name: "Record and continue" });
    await expect(practiceComplete).toBeDisabled();
    await page.getByPlaceholder("Explain the workflow in your own words").fill(
      "A synthetic inbound referral becomes one governed workspace. Packet evidence supports readiness, the assigned assessor documents and signs, an authorized lead decides, and only an accepted record proceeds to EHR handoff.",
    );
    await expect(practiceComplete).toBeEnabled();
    await practiceComplete.click();

    await expect(page.getByRole("heading", { name: "Verify your judgment" })).toBeVisible();
    await page.getByRole("button", { name: /Store one governed operational record/ }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText(/Correct\. Pipeline coordinates the admissions workflow/)).toBeVisible();
    await page.getByRole("button", { name: "Record and continue" }).click();
    await expect(page.getByRole("heading", { name: "Navigate without losing context" })).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Navigate without losing context" })).toBeVisible();
    await expect(page.getByText("4/4 · 45m", { exact: true })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("connects practice, job aids, product map, and certification", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();

    await page.getByRole("tab", { name: "Practice lab" }).click();
    await expect(page.getByRole("heading", { name: "Possible duplicate at intake" })).toBeVisible();
    await page.getByRole("button", { name: /Stop creation and route the possible match/ }).click();
    await page.getByRole("button", { name: "Check decision" }).click();
    await expect(page.getByText("Safe decision")).toBeVisible();
    await expect(page.getByText("Passed", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Job aids" }).click();
    await expect(page.getByRole("heading", { name: "Job aids" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create a referral safely" })).toBeVisible();
    await page.getByPlaceholder("Search job aids").fill("EHR");
    await expect(page.getByRole("heading", { name: "Complete EHR handoff" })).toBeVisible();

    await page.getByRole("tab", { name: "Product map" }).click();
    await expect(page.getByRole("heading", { name: "Product map" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral workspace" })).toBeVisible();

    await page.getByRole("tab", { name: "Certification" }).click();
    await expect(page.getByRole("heading", { name: "Role readiness record" })).toBeVisible();
    await expect(page.getByText("Supervisor observation remains required")).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("remains usable at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practice the work before it counts." })).toBeVisible();
    await expect(page.getByLabel("Current module")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("tab", { name: "Practice lab" }).click();
    await expect(page.getByRole("heading", { name: "Possible duplicate at intake" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("is discoverable from the signed-in profile menu", async ({ page }) => {
    await page.goto(homeUrl);
    await page.getByRole("button", { name: /Open profile menu for/ }).click();
    const learningLink = page.getByRole("link", { name: /Learning Center Role-based workflow training and certification/ });
    await expect(learningLink).toBeVisible();
    await learningLink.click();
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Practice the work before it counts." })).toBeVisible();
  });

  test("runs a deterministic target-verified tutorial across product routes", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("tab", { name: "Guided tours" }).click();
    await expect(page.getByRole("heading", { name: "Practice the work by doing it." })).toBeVisible();

    const firstShift = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Run your start-of-shift workflow" }) });
    await firstShift.getByRole("button", { name: "Start guided practice" }).click();
    await expect(page.getByRole("dialog", { name: /Run your start-of-shift workflow guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Read your due-today, overdue, and blocked work" })).toBeVisible();
    await expect(page.locator('[data-guide-target="my-queue"]')).toBeVisible();

    await page.getByRole("button", { name: "Why this matters" }).click();
    await expect(page.getByText("Ownership and urgency create a repeatable start to each shift.")).toBeVisible();
    await page.getByRole("button", { name: "Mark action complete" }).click();
    await expect(page.getByRole("heading", { name: "Open the shared referral queue" })).toBeVisible();
    await page.getByLabel("Open referrals").click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Limit the list to actionable work" })).toBeVisible();
    await page.getByRole("button", { name: /Current work/ }).click();
    await expect(page.getByRole("heading", { name: "Run a focused workspace search" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search all workspaces" }).fill("synthetic");
    await expect(page.getByRole("heading", { name: "Open scheduled assessment work" })).toBeVisible();
    await page.getByLabel("Open calendar").click();
    await expect(page.getByRole("heading", { name: "Choose the time horizon for the question" })).toBeVisible();
    await page.getByRole("button", { name: "agenda" }).click();
    await expect(page.getByRole("heading", { name: "Apply one schedule filter" })).toBeVisible();
    await page.getByLabel("Filter calendar by event type").selectOption({ index: 1 });
    await expect(page.getByRole("heading", { name: "Return to accountable work" })).toBeVisible();
    await page.getByRole("button", { name: "Pipeline home" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("persists a paused guide and only accepts authored chat commands", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(homeUrl);
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await page.getByRole("button", { name: /Run your start-of-shift workflow/ }).click();
    const command = page.getByRole("textbox", { name: "Guide command" });
    await command.fill("tell me something about this client");
    await page.getByRole("button", { name: "Send guide command" }).click();
    await expect(page.getByText(/I use authored commands only/)).toBeVisible();
    await expect(page.getByText(/Do not enter names, packet text, or other PHI/)).toBeVisible();

    await page.getByRole("button", { name: "Pause tutorial" }).click();
    await expect(page.getByRole("button", { name: "Resume guided tutorial" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Resume guided tutorial" }).click();
    await expect(page.getByRole("heading", { name: "Read your due-today, overdue, and blocked work" })).toBeVisible();
  });

  test("keeps guided mode usable at a narrow viewport", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(homeUrl);
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await page.getByRole("button", { name: /Run your start-of-shift workflow/ }).click();
    await expect(page.getByRole("dialog", { name: /Run your start-of-shift workflow guided tutorial/ })).toBeVisible();
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
