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

  test("shows chaptered task modules and opens an individual lesson tooltip", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    const response = await page.goto(trainingUrl);
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "I want to..." })).toBeVisible();
    const taskTiles = page.locator('section[aria-label="Pipeline tasks"] > div > button');
    await expect(taskTiles.first()).toHaveAccessibleName("Open Create a referral");
    await expect(page.getByRole("button", { name: "Open full Pipeline walkthrough" })).toBeVisible();

    await page.getByRole("button", { name: "Open Finish an assessment" }).click();
    await expect(page.getByRole("heading", { name: "Finish an assessment" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Finish an assessment chapters" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Find", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start guided walkthrough: Finish an assessment" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Finish an assessment chapters" })
      .getByRole("button", { name: /^02 Open/ })
      .click();
    await expect(page.getByRole("heading", { name: "Open Assessment" })).toBeVisible();
    await page.getByRole("navigation", { name: "Finish an assessment chapters" }).getByRole("button", { name: /^03 Sections/ }).click();
    for (const section of ["Client & referral", "Placement", "History", "Clinical", "Function", "Medication", "Substance use", "Behavior & safety", "Physical health", "Legal", "Support & goals", "Review"]) {
      await expect(page.getByRole("heading", { name: section, exact: true })).toBeVisible();
    }
    await page.getByRole("navigation", { name: "Finish an assessment chapters" }).getByRole("button", { name: /^02 Open/ }).click();
    await page.getByRole("button", { name: "Open guided tooltip for Open Assessment" }).click();
    await expect(page.getByRole("dialog", { name: /Finish an assessment guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Open Assessment" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("starts an assessor workflow and advances through real controls", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Check my work" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Check my work" }).click();

    await expect(page.getByRole("dialog", { name: /Check my work guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check your queue" })).toBeVisible();
    await expect(page.locator('[data-guide-target="my-queue"]')).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await page.getByLabel("Open referrals").click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Search for the referral" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("lets an operator skip a step without performing its action", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Find a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find a referral" }).click();

    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Search referrals" })).toBeVisible();
  });

  test("guides referral intake without covering the upload control", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Create a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Create a referral" }).click();

    await expect(page.getByRole("heading", { name: "Select New referral" })).toBeVisible();
    await page.getByLabel("Create new referral").click();
    await expect(page).toHaveURL(/view=referrals&screen=packet/);

    const coach = page.getByTestId("guided-coach-panel");
    const upload = page.getByRole("group", { name: "Upload initial referral document" });
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
    await expect(coach).not.toContainText("This step is on another Pipeline page.");
    await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
    await expect(upload).toBeVisible();
    await expect(upload.getByRole("button", { name: "Choose file" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, upload);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await upload.getByRole("button", { name: "Choose file" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "training-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Not an accepted referral document"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "Upload a PDF, JPEG, PNG, TIFF, or HEIC referral document." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();

    await dropTrainingPdf(upload, "training-referral.pdf");
    await expect(page.getByRole("alert").filter({ hasText: "Upload a PDF" })).toHaveCount(0);
    await expect(upload.getByText("training-referral.pdf", { exact: true })).toBeVisible();
    await expect(upload.getByText(/Ready to upload/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Verify identity" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="intake-identity"]'));

    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page.getByRole("heading", { name: "Assign the referral" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="intake-routing"]'));
    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page.getByRole("heading", { name: "Add medication information" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="intake-medications"]'));
    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page.getByRole("heading", { name: "Review before creating" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="create-workspace"]'));
    await page.getByRole("button", { name: "Skip and finish" }).click();
    await expect(coach).toBeHidden();
    await expect.poll(() => errors).toEqual([]);
  });

  test("persists and resumes a paused walkthrough", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Find a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find a referral" }).click();
    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await page.getByRole("button", { name: "Pause tutorial" }).click();

    await page.reload();
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await page.getByRole("button", { name: /Continue where you stopped/ }).click();
    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
  });

  test("keeps an unfinished walkthrough closed on an ordinary return", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Find a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find a referral" }).click();
    await expect(page.getByRole("dialog", { name: /Find a referral guided tutorial/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("dialog", { name: /guided tutorial/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue where you stopped/ })).toBeVisible();
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

  test("presents the workflow concepts before starting the real guided tour", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    const preview = page.getByRole("dialog", { name: "Full Pipeline walkthrough" });
    await expect(async () => {
      await page.getByRole("button", { name: "Open full Pipeline walkthrough" }).click();
      await expect(preview).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 5_000 });
    const previewBox = await preview.boundingBox();
    const viewport = page.viewportSize();
    expect(previewBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(previewBox!.x).toBeGreaterThanOrEqual(0);
    expect(previewBox!.y).toBeGreaterThanOrEqual(0);
    expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(viewport!.height);
    await expect(preview.getByRole("heading", { name: "How Pipeline moves a referral" })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "One referral, one workspace" })).toBeVisible();

    for (const heading of [
      "The packet starts the record",
      "Scheduling creates the plan",
      "The interview is the assessment",
      "Completion creates the chart",
      "Review closes the referral loop",
    ]) {
      await preview.getByRole("button", { name: "Next concept" }).click();
      await expect(preview.getByRole("heading", { name: heading })).toBeVisible();
    }
    await preview.getByRole("button", { name: "Continue" }).click();
    await expect(preview.getByRole("heading", { name: "From concepts to the real workflow" })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Follow the workflow where it happens." })).toBeVisible();
    await expect(preview.getByText(/guided tour now opens the real Pipeline pages/)).toBeVisible();
    await expect(preview.getByText(/Nothing is submitted for you/)).toBeVisible();
    await preview.getByRole("button", { name: "Start guided tour" }).click();
    await expect(preview).toBeHidden();
    const coach = page.getByRole("dialog", { name: "Full Pipeline walkthrough guided tutorial" });
    await expect(coach).toBeVisible();
    await expect(coach.getByText("Full tour · Module 1 of 4")).toBeVisible();
    await expect(coach.getByRole("heading", { name: "Select New referral" })).toBeVisible();
    await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
    await coach.getByRole("button", { name: "Skip step" }).click();
    await expect(page).toHaveURL(/view=referrals&screen=packet/);
    await expect(coach.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
  });

  test("keeps the Learning Center and guide usable at a narrow viewport", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "I want to..." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "Open full Pipeline walkthrough" }).click();
    const preview = page.getByRole("dialog", { name: "Full Pipeline walkthrough" });
    await expect(preview.getByRole("button", { name: "Next concept" })).toBeInViewport();
    await preview.getByRole("button", { name: "Close full walkthrough" }).click();

    await page.getByRole("button", { name: "Open Find a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Find a referral" }).click();
    await expect(page.getByRole("dialog", { name: /Find a referral guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip step" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("keeps the referral upload guide clear at a narrow viewport", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(trainingUrl);
    await expect(page.locator('[data-training-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Open Create a referral" }).click();
    await page.getByRole("button", { name: "Start guided walkthrough: Create a referral" }).click();

    await page.getByLabel("Create new referral").click();
    await expect(page).toHaveURL(/view=referrals&screen=packet/);

    const coach = page.getByTestId("guided-coach-panel");
    const upload = page.getByRole("group", { name: "Upload initial referral document" });
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, upload);
    await expect(upload.getByRole("button", { name: "Choose file" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect.poll(() => errors).toEqual([]);
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

async function expectGuideDoesNotCoverTarget(
  coach: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
) {
  await expect(coach).toBeVisible();
  await expect(target).toBeVisible();
  await expect.poll(async () => {
    const [coachBox, targetBox] = await Promise.all([coach.boundingBox(), target.boundingBox()]);
    if (!coachBox || !targetBox) return false;
    const overlapWidth = Math.max(0, Math.min(coachBox.x + coachBox.width, targetBox.x + targetBox.width) - Math.max(coachBox.x, targetBox.x));
    const overlapHeight = Math.max(0, Math.min(coachBox.y + coachBox.height, targetBox.y + targetBox.height) - Math.max(coachBox.y, targetBox.y));
    return overlapWidth * overlapHeight === 0;
  }).toBe(true);
}

async function dropTrainingPdf(target: import("@playwright/test").Locator, name: string) {
  await target.evaluate((element, fileName) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["%PDF-1.4\n% Pipeline training fixture\n"], fileName, {
        type: "application/pdf",
      }),
    );
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, name);
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
