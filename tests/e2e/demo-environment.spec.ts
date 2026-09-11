import { expect, test, type Locator } from "@playwright/test";

test.describe("Pipeline Demo Environment", () => {
  test("runs a complete hybrid medication section", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto("/training/assessment-preview");
    expect(response?.status()).toBe(200);

    const preview = page.getByRole("dialog", { name: "Focused assessment preview" });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Is the client taking medication as prescribed?" })).toBeVisible();
    await expect(preview.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
    await expect(preview.getByRole("heading", { name: "Record the refusals" })).toBeVisible();
    await expect(preview.getByLabel("Most recent refusal")).toHaveValue("2026-09-02");
    await expect(preview.getByLabel("Medication refused")).toHaveValue("Synthetic medication A");
    await expect(preview.getByRole("spinbutton", { name: "Refusals in the last 30 days" })).toHaveValue("2");

    await preview.getByRole("radio", { name: "Yes" }).click();
    await expect(preview.getByRole("heading", { name: "Record the refusals" })).toHaveCount(0);
    await preview.getByRole("radio", { name: "No" }).click();
    await preview.getByRole("button", { name: "Continue" }).click();
    await expect(preview.getByRole("heading", { name: "What medications is the client currently taking?" })).toBeVisible();
    await expect(preview.getByRole("textbox", { name: "Medications at intake" })).toHaveValue(/Synthetic medication A/);
    await expect(preview.getByRole("radio", { name: "Oral only" })).toHaveAttribute("aria-checked", "true");

    await preview.getByRole("button", { name: "Continue" }).click();
    await expect(preview.getByRole("heading", { name: "Does the client receive IM injections?" })).toBeVisible();
    await expect(preview.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");

    await preview.getByRole("button", { name: "Continue" }).click();
    await expect(preview.getByRole("heading", { name: "Review the Medication section" })).toBeVisible();
    await expect(preview.getByText("No · 2 refusals in the last 30 days")).toBeVisible();
    await expect(preview.getByText("2 listed · Oral only")).toBeVisible();

    await preview.getByRole("button", { name: "Back" }).click();
    await expect(preview.getByRole("heading", { name: "Does the client receive IM injections?" })).toBeVisible();

    const bounds = await preview.boundingBox();
    expect(bounds).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(preview.getByRole("button", { name: "Continue" })).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test("opens a real synthetic assessment rehearsal", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = watchBrowserErrors(page);
    const response = await page.goto("/training/demo");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "One referral stays connected from packet to decision" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pipeline training" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);
    await closePresentation(page);
    await page.getByRole("tab", { name: "Practice cases" }).click();

    const scenario = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Assessment interview" }),
    });
    const newAttempt = scenario.getByRole("button", { name: /^(Start|New attempt)$/ });
    await expect(newAttempt).toBeEnabled();
    await newAttempt.click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=assessment/);
    await expect(page.locator('[data-pipeline-demo-banner="true"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /02 Assessment/ })).toHaveAttribute("aria-current", "page");
    const interview = page.getByRole("dialog", { name: "Assessment interview" });
    await expect(interview).toBeVisible();
    await expect(interview).toHaveAttribute("data-guided-assessment", "true");
    await expect(interview).toHaveAttribute("data-total-questions", "151");
    await expect(interview.getByRole("textbox", { name: "Resident number" })).toBeEditable();
    const desktopNextBounds = await interview.getByRole("button", { name: "Next", exact: true }).boundingBox();
    expect(desktopNextBounds).not.toBeNull();
    expect((desktopNextBounds?.x ?? 0) + (desktopNextBounds?.width ?? 0)).toBeGreaterThan(1_390);
    await interview.getByRole("button", { name: "Next", exact: true }).click();
    const desktopBackBounds = await interview.getByRole("button", { name: "Back", exact: true }).boundingBox();
    expect(desktopBackBounds?.x ?? 100).toBeLessThan(60);
    await interview.getByRole("button", { name: "Back", exact: true }).click();
    await interview.getByRole("textbox", { name: "Resident number" }).fill("TR-1008");
    await interview.getByRole("button", { name: "Exit guided interview" }).click();
    await expect(interview).toHaveAttribute("data-assessment-view", "chart");
    await expect(interview.getByRole("textbox", { name: "Resident number" })).toHaveValue("TR-1008");
    await interview.getByRole("button", { name: /Clinical 0\/6/ }).click();
    await expect(interview.getByRole("heading", { name: "Current presentation" })).toBeVisible();
    await expect(interview.getByRole("textbox", { name: "Current symptoms" })).toBeEditable();
    await interview.getByText("Language Lab", { exact: true }).first().click();
    await expect(interview.getByText("Use this order", { exact: true }).first()).toBeVisible();

    await interview.getByRole("button", { name: "Guided interview" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await interview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(interview.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    const screenCount = Number(await interview.getAttribute("data-visible-screens"));
    expect(screenCount).toBeGreaterThan(20);
    expect(screenCount).toBeLessThan(50);
    for (let index = 0; index < screenCount; index += 1) {
      const next = interview.getByRole("button", { name: "Next", exact: true });
      if (await next.count() === 0) break;
      await next.click();
    }
    await interview.getByRole("button", { name: "Done", exact: true }).click();
    await expect(interview).toHaveAttribute("data-assessment-view", "chart");
    await expect(interview.getByRole("heading", { name: "Review", exact: true })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("moves directly from the presentation into the real walkthrough", async ({ page }) => {
    await page.goto("/training/demo");

    const slideNavigation = page.getByRole("navigation", { name: "Presentation slides" });
    const slideSelect = slideNavigation.getByRole("combobox", { name: "Jump to slide" });
    await expect(page.getByRole("heading", { name: "One referral stays connected from packet to decision" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Taylor Rivera referral journey" })).toContainText("remain connected");
    await slideSelect.selectOption("1");
    await expect(page.getByRole("region", { name: "Home calendar and workspace sequence" })).toContainText("One connected record");

    await slideSelect.selectOption("2");
    await expect(page.getByRole("img", { name: /Intake screen with the referral packet area highlighted/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the intake walkthrough" })).toBeVisible();
    await page.getByRole("button", { name: "View full size" }).click();
    await expect(page.getByRole("dialog", { name: "Intake and packet full-size screen" })).toBeVisible();
    await page.getByRole("button", { name: "Close full-size screen" }).click();

    await slideSelect.selectOption("4");
    await expect(page.getByRole("img", { name: /Schedule dialog open and the scheduling tooltip walkthrough/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Calendar" })).toBeVisible();

    await slideSelect.selectOption("6");
    await expect(page.getByRole("region", { name: "Weak and source-backed note comparison" })).toContainText("Source-attributed");

    await page.keyboard.press("End");
    await expect(page.getByRole("heading", { name: "Submit the recommendation, then the supervisor decides" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Assessment signature and decision sequence" })).toContainText("Admission decision");
    await page.getByRole("button", { name: "Begin walkthrough" }).click();

    await expect(page).toHaveURL(/view=referrals.*screen=packet.*draftId=.*demoScenario=new-intake/);
    await expect(page.getByRole("dialog", { name: "Create a referral guided tutorial" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
  });

  test("defers practice data until the practice surface is opened", async ({ page }) => {
    const referralRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname.endsWith("/api/referrals") && url.searchParams.get("tag") === "pipeline-demo") {
        referralRequests.push(url.toString());
      }
    });

    await page.goto("/training/demo");
    await expect(page.getByRole("heading", { name: "One referral stays connected from packet to decision" })).toBeVisible();
    expect(referralRequests).toEqual([]);

    await closePresentation(page);
    await expect.poll(() => referralRequests.length).toBe(1);
  });

  test("uses the full viewport for the presentation and the full application body for demo pages", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/training/demo");
    const center = page.locator('[data-demo-center="true"]');
    const presentation = page.locator('[data-demo-surface="presentation"]');
    await expect(presentation).toBeVisible();

    await expectPresentationToFillViewport(presentation, page);
    expect(await center.evaluate((element) => element.scrollHeight)).toBe(await center.evaluate((element) => element.clientHeight));

    await closePresentation(page);
    const practice = page.locator('[data-demo-surface="practice"]');
    await expect(practice).toBeVisible();
    await expectDemoSurfaceToFillBody(practice, center);
  });

  test("opens Language Lab inside the real assessment", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto("/training/demo");

    const slideNavigation = page.getByRole("navigation", { name: "Presentation slides" });
    await slideNavigation.getByRole("combobox", { name: "Jump to slide" }).selectOption("6");
    await page.getByRole("button", { name: "Try Language Lab in the assessment" }).click();

    await expect(page).toHaveURL(/trainingAssessment=interview.*assessmentSection=prior_history/);
    const coach = page.getByRole("dialog", { name: "Finish an assessment guided tutorial" });
    const interview = page.getByRole("dialog", { name: "Assessment interview" });
    await expect(coach.getByRole("heading", { name: "Enter an answer" })).toBeVisible();
    await interview.locator('[data-guide-target~="assessment-answer"]:visible').first().fill("Client reports one crisis visit last month; packet review is pending.");
    await expect(coach.getByRole("heading", { name: "Open Language Lab" })).toBeVisible();
    await interview.locator('[data-guide-target~="assessment-answer-help"]:visible').first().click();
    await expect(interview.getByText("Use this order", { exact: true }).first()).toBeVisible();
  });

  test("starts an intake guide from the workspace slide", async ({ page }) => {
    await page.goto("/training/demo");
    await page.getByRole("navigation", { name: "Presentation slides" }).getByRole("combobox", { name: "Jump to slide" }).selectOption("2");
    await page.getByRole("button", { name: "Try the intake walkthrough" }).click();

    await expect(page).toHaveURL(/view=referrals.*screen=packet.*draftId=.*demoScenario=new-intake/);
    await expect(page.getByRole("dialog", { name: "Create a referral guided tutorial" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Upload initial referral document" })).toBeVisible();
  });

  test("navigates the interview walkthrough through every real assessment section", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto("/training/demo");
    await page.getByRole("navigation", { name: "Presentation slides" }).getByRole("combobox", { name: "Jump to slide" }).selectOption("5");
    await page.getByRole("button", { name: "Start the assessment walkthrough" }).click();

    await expect(page).toHaveURL(/screen=packet.*workspaceStage=assessment.*trainingAssessment=interview/);
    const coach = page.getByRole("dialog", { name: "Finish an assessment guided tutorial" });
    await expect(coach).toBeVisible();
    await expect(coach.getByRole("button", { name: "Open page" })).toHaveCount(0);
    await expect(coach.getByText("Do this", { exact: true })).toHaveCount(0);
    await expect(coach.getByText("Done when", { exact: true })).toHaveCount(0);
    await expect(coach.getByText("Why this matters", { exact: true })).toHaveCount(0);
    await expect(coach.getByText("Review this section, then select it to continue.", { exact: true })).toBeVisible();
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
    await expect(coach.getByRole("heading", { name: "Open Language Lab" })).toBeVisible();
    await interview.locator('[data-guide-target~="assessment-answer-help"]:visible').first().click();
    await expect(interview.getByText("Use this order", { exact: true }).first()).toBeVisible();
    await coach.getByRole("button", { name: "Continue" }).click();

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

  test("moves directly from a saved schedule into the assessment", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.goto("/training/demo");
    await page.getByRole("navigation", { name: "Presentation slides" }).getByRole("combobox", { name: "Jump to slide" }).selectOption("4");
    await page.getByRole("button", { name: "Try the scheduling walkthrough" }).click();

    const coach = page.getByRole("dialog", { name: "Schedule an assessment guided tutorial" });
    const schedule = page.getByRole("dialog", { name: "Schedule assessment" });
    await expect(coach.getByRole("heading", { name: "Set the appointment" })).toBeVisible();
    const appointment = schedule.getByLabel("Assessment date and time");
    await appointment.fill(futureLocalDateTime());
    await appointment.blur();
    await expect(coach.getByRole("heading", { name: "Choose the interview method" })).toBeVisible();
    await schedule.getByLabel("Assessment method").selectOption("zoom");
    await expect(coach.getByRole("heading", { name: "Save the schedule" })).toBeVisible();
    await schedule.getByLabel("Assessment location or link").fill("https://example.invalid/pipeline-training");
    await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();

    await expect(page).toHaveURL(/trainingAssessment=interview.*assessmentSection=identity/);
    await expect(page.getByRole("dialog", { name: "Begin assessment" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Assessment interview" })).toBeVisible();
    await expect(coach.getByRole("heading", { name: "Open the assessment" })).toBeVisible();
    await expect(coach).toContainText("Select the highlighted control.");
    await expect.poll(() => errors).toEqual([]);
  });

  test("keeps the presentation and practice cases usable on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/training/demo");
    await expect(page.getByRole("heading", { name: "One referral stays connected from packet to decision" })).toBeVisible();
    await page.getByRole("navigation", { name: "Presentation slides" }).getByRole("combobox", { name: "Jump to slide" }).selectOption("2");
    await expect(page.getByRole("img", { name: /Intake screen with the referral packet area highlighted/ })).toBeVisible();
    await closePresentation(page);
    await expect(page.locator('[data-demo-surface="practice"]')).toBeVisible();
    const center = page.locator('[data-demo-center="true"]');
    expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const tab of ["Presentation", "Practice cases", "Submittal & acceptance"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("keeps every training surface usable at tablet size", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/training/demo");
    const center = page.locator('[data-demo-center="true"]');
    await expectPresentationToFillViewport(page.locator('[data-demo-surface="presentation"]'), page);
    await closePresentation(page);

    for (const tab of ["Practice cases", "Submittal & acceptance"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      expect(await center.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    await page.getByRole("tab", { name: "Practice cases" }).click();
    await expect(page.locator('[data-demo-surface="practice"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("rehearses assessor submittal and supervisor acceptance without changing data", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`);
    });

    await page.goto("/training/demo");
    await closePresentation(page);
    const decisionTab = page.getByRole("tab", { name: "Submittal & acceptance" });
    await expect(decisionTab).toBeVisible();
    await page.waitForLoadState("networkidle");
    await decisionTab.click();
    await expect(decisionTab).toHaveAttribute("aria-selected", "true");
    const rehearsal = page.locator('[data-submittal-acceptance-demo="true"]');
    await expect(rehearsal).toBeVisible();
    await rehearsal.getByRole("button", { name: "Submit for supervisor review" }).click();
    await expect(rehearsal.getByText("Awaiting supervisor review", { exact: true })).toBeVisible();
    await rehearsal.getByRole("button", { name: "Record accepted decision" }).click();
    await expect(rehearsal.getByRole("button", { name: "Accepted decision recorded" })).toBeVisible();
    expect(requests).toEqual([]);
  });
});

async function expectDemoSurfaceToFillBody(surface: Locator, center: Locator) {
  const [centerBox, surfaceBox] = await Promise.all([center.boundingBox(), surface.boundingBox()]);
  expect(centerBox).not.toBeNull();
  expect(surfaceBox).not.toBeNull();
  if (!centerBox || !surfaceBox) throw new Error("The demo surface must have measurable bounds.");
  expect(Math.abs(surfaceBox.x - centerBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(surfaceBox.width - centerBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs((surfaceBox.y + surfaceBox.height) - (centerBox.y + centerBox.height))).toBeLessThanOrEqual(1);
}

async function expectPresentationToFillViewport(surface: Locator, page: import("@playwright/test").Page) {
  await expect(surface).toBeVisible();
  const [box, viewport] = await Promise.all([surface.boundingBox(), page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))]);
  expect(box).not.toBeNull();
  if (!box) throw new Error("The presentation must have measurable bounds.");
  expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
}

async function closePresentation(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Close presentation" }).click();
  await expect(page.getByRole("tab", { name: "Practice cases" })).toHaveAttribute("aria-selected", "true");
}

function watchBrowserErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error" || message.text().includes("/_next/webpack-hmr")) return;
    const sourceUrl = message.location().url;
    errors.push(sourceUrl ? `${message.text()} (${sourceUrl})` : message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function futureLocalDateTime() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  date.setMinutes(0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
