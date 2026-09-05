import { expect, test } from "@playwright/test";

test.describe("Pipeline Demo Environment", () => {
  test("creates and opens a real synthetic assessment rehearsal", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const response = await page.goto("/training/demo");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Pipeline training" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Practice cases" }).click();

    const scenario = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Assessment interview" }),
    });
    await scenario.getByRole("button", { name: /^(Start|New attempt)$/ }).click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=assessment/);
    await expect(page.locator('[data-pipeline-demo-banner="true"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /02 Assessment/ })).toHaveAttribute("aria-current", "page");
    const interview = page.getByRole("dialog", { name: "Assessment interview" });
    await expect(interview).toBeVisible();
    await expect(interview.getByRole("textbox", { name: "Resident number" })).toBeEditable();
    await interview.getByRole("button", { name: /Clinical 0\/6/ }).click();
    await expect(interview.getByRole("heading", { name: "Current presentation" })).toBeVisible();
    await expect(interview.getByRole("textbox", { name: "Current symptoms" })).toBeEditable();
    await interview.getByText("Answer format", { exact: true }).first().click();
    await expect(interview.getByText("Use this order", { exact: true }).first()).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("separates the presentation from the referral journey", async ({ page }) => {
    await page.goto("/training/demo");

    const presentationTab = page.getByRole("tab", { name: "Presentation" });
    await expect(presentationTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "One referral, one record" })).toBeVisible();
    await expect(page.getByText("Email + packet", { exact: true })).toBeVisible();

    await page.getByRole("navigation", { name: "Presentation slides" }).getByRole("button", { name: /05 Accepted referral/ }).click();
    await expect(page.getByRole("heading", { name: "Accepted referral" })).toBeVisible();
    await page.locator('[data-demo-center="true"]').evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await page.getByRole("button", { name: "Open referral journey" }).click();

    await expect(page.getByRole("tab", { name: "Referral journey" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Create the referral" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Referral journey stages" })).toBeVisible();
    await expect.poll(() => page.locator('[data-demo-center="true"]').evaluate((element) => element.scrollTop)).toBe(0);
  });

  test("starts the referral journey in the real intake workspace", async ({ page }) => {
    await page.goto("/training/demo");
    await page.getByRole("tab", { name: "Referral journey" }).click();
    await page.getByRole("button", { name: "Open guided practice" }).click();

    await expect(page).toHaveURL(/view=referrals.*screen=packet.*draftId=.*demoScenario=new-intake/);
    await expect(page.getByRole("dialog", { name: "Create a referral guided tutorial" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Upload initial referral document" })).toBeVisible();
  });

  test("navigates the interview walkthrough through every real assessment section", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto("/training/demo");
    await page.getByRole("tab", { name: "Referral journey" }).click();
    await page.getByRole("navigation", { name: "Referral journey stages" }).getByRole("button", { name: /Complete the interview/ }).click();
    await page.getByRole("button", { name: "Open guided practice" }).click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=assessment.*trainingAssessment=interview/);
    const coach = page.getByRole("dialog", { name: "Finish an assessment guided tutorial" });
    await expect(coach).toBeVisible();
    await expect(coach.getByRole("button", { name: "Open page" })).toHaveCount(0);
    await expect(coach.getByText("Do this", { exact: true })).toHaveCount(0);
    await expect(coach.getByText("Done when", { exact: true })).toHaveCount(0);
    await expect(coach.getByText("Why this matters", { exact: true })).toHaveCount(0);
    await expect(coach.getByText(/Check the name, date of birth, community, referral date/)).toBeVisible();
    const interview = page.getByRole("dialog", { name: "Assessment interview" });
    const sectionNavigation = interview.getByRole("navigation", { name: "Assessment sections" });
    await expect(sectionNavigation).toBeVisible();
    for (const section of ["Client & referral", "Placement", "History", "Clinical", "Function", "Medication", "Substance use", "Behavior & safety", "Physical health", "Legal", "Support & goals", "Review"]) {
      await expect(interview.getByRole("button", { name: new RegExp(`^${escapeRegExp(section)} \\d+/\\d+$`) })).toBeVisible();
    }

    const confirmSection = async (section: string, routeSection: string) => {
      await expect(page).toHaveURL(new RegExp(`assessmentSection=${routeSection}`));
      await expect(coach.getByRole("heading", { name: section, exact: true })).toBeVisible();
      await expect(interview.getByRole("heading", { name: section, exact: true })).toBeVisible();
      const sectionButton = sectionNavigation.getByRole("button", { name: new RegExp(`^${escapeRegExp(section)} \\d+/\\d+$`) });
      await expect(sectionButton).toHaveAttribute("aria-current", "step");
      await sectionButton.click();
    };

    await confirmSection("Client & referral", "identity");
    await confirmSection("Placement", "prior_placement");
    await confirmSection("History", "prior_history");

    await expect(coach.getByRole("heading", { name: "Enter an answer" })).toBeVisible();
    await interview.locator('[data-guide-target~="assessment-answer"]:visible').first().fill("Synthetic history reviewed with the client.");
    await expect(coach.getByRole("heading", { name: "Open Answer Help" })).toBeVisible();
    await interview.locator('[data-guide-target~="assessment-answer-help"]:visible').first().click();

    await confirmSection("Clinical", "diagnosis_clinical");
    await confirmSection("Function", "functional_adl");
    await confirmSection("Medication", "medication");
    await confirmSection("Substance use", "substance_use");
    await confirmSection("Behavior & safety", "behavioral_risk");
    await confirmSection("Physical health", "physical_health");
    await confirmSection("Legal", "legal_conservatorship");
    await confirmSection("Support & goals", "social_support");
    await confirmSection("Review", "provenance_qc");
    await expect(coach.getByRole("heading", { name: "Check saved" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("opens intake review on Intake instead of skipping ahead to Assessment", async ({ page }) => {
    await page.goto("/training/demo");
    await page.getByRole("tab", { name: "Referral journey" }).click();
    await page.getByRole("navigation", { name: "Referral journey stages" }).getByRole("button", { name: /Review the intake/ }).click();
    await page.getByRole("button", { name: "Open practice record" }).click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=intake/);
    await expect(page.getByRole("button", { name: /01 Intake/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: /02 Assessment/ })).not.toHaveAttribute("aria-current", "page");
  });

  test("keeps the presentation and referral journey usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/training/demo");
    await expect(page.getByRole("heading", { name: "Pipeline training" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "One referral, one record" })).toBeVisible();
    await page.getByRole("tab", { name: "Referral journey" }).click();
    await expect(page.getByRole("heading", { name: "Create the referral" })).toBeVisible();
    await expect(page.getByText("Attach the source packet", { exact: true })).toBeVisible();
    const center = page.locator('[data-demo-center="true"]');
    expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const tab of ["Presentation", "Referral journey", "Practice cases", "Meet the Client"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("keeps every training surface usable at tablet size", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/training/demo");
    const center = page.locator('[data-demo-center="true"]');

    for (const tab of ["Presentation", "Referral journey", "Practice cases", "Meet the Client"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    await page.getByRole("tab", { name: "Referral journey" }).click();
    await expect(page.getByRole("navigation", { name: "Referral journey stages" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open guided practice" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("previews a Resident Care Director handoff without sending data", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`);
    });

    await page.goto("/training/demo");
    const meetClientTab = page.getByRole("tab", { name: "Meet the Client" });
    await expect(meetClientTab).toBeVisible();
    await page.waitForLoadState("networkidle");
    await meetClientTab.click();
    await expect(meetClientTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-meet-client-demo="true"]')).toBeVisible();
    const emailPreview = page.getByRole("article", { name: "Meet the Client email preview" });
    await expect(emailPreview.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New message" })).toBeVisible();
    await expect(page.getByText("Referral Face Sheet.pdf")).toBeVisible();

    await expect(emailPreview).toBeVisible();
    await page.getByRole("button", { name: "Simulate delivery" }).click();
    await expect(page.getByText("Demo delivery complete")).toBeVisible();
    expect(requests).toEqual([]);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function mockTrainingProgress(page: import("@playwright/test").Page) {
  let revision = 0;
  let progress = {
    version: 2,
    curriculumVersion: "e2e",
    role: "admin",
    completedActivityIds: [],
    activeModuleId: "pipeline-purpose",
    activeActivityId: "overview",
    evidence: {},
    confidence: {},
    scenarioResults: {},
    tutorialResults: {},
  };
  await page.route("**/api/training/progress", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { progress?: typeof progress };
      if (body.progress) progress = body.progress;
      revision += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision, progress, updatedAt: null, persistence: "browser" }),
    });
  });
}
