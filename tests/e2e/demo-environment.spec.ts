import { expect, test, type Page } from "@playwright/test";

// bb5e18a retired the presentation pages. Test the current Help practice owners.
const practice = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=diagnosis_clinical&demo=1";
function watchWorkflowWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && /^\/api\/(?:referrals|assessments|demo|me\/referral-drafts)(?:\/|$)/.test(path)) writes.push(`${request.method()} ${path}`);
  });
  return writes;
}

for (const width of [320, 390, 834, 1440]) {
  test(`synthetic assessment edits and Language Lab remain isolated and usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = watchWorkflowWrites(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(practice);
    const assessment = page.locator('[data-assessment-view="assessment"]');
    await expect(assessment).toBeVisible();
    const answer = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await expect(answer).toBeEditable();
    const text = "Synthetic interview finding\nAdditional documented history";
    await answer.fill(text);
    await answer.blur();
    await expect(answer).toHaveValue(text);
    const guidance = assessment.locator('summary[aria-label="Language Lab for Secondary diagnosis"]');
    await guidance.click();
    await expect(guidance.locator("..")).toContainText("One diagnosis per line");
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 640) {
      await expect(page.getByRole("button", { name: "Choose questionnaire section", exact: true })).toBeInViewport();
      await expect(page.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: /^Next/ })).toBeInViewport();
    } else {
      const sections = assessment.getByRole("combobox", { name: "Assessment section", exact: true });
      await expect(sections.locator("option")).toHaveCount(12);
      await sections.selectOption("functional_adl");
      await sections.selectOption("diagnosis_clinical");
      await assessment.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
      await expect(answer).toHaveValue(text);
    }
    await page.screenshot({ path: info.outputPath(`practice-${width}.png`) });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("leaving practice removes its scope without converting practice answers into live records", async ({ page }) => {
  const writes = watchWorkflowWrites(page);
  await page.goto(practice);
  await expect(page.locator('[data-assessment-view="assessment"]')).toBeVisible();
  await page.getByRole("textbox", { name: "Secondary diagnosis", exact: true }).fill("Synthetic practice only");
  await page.getByRole("button", { name: "Open referrals", exact: true }).click();
  await expect(page).toHaveURL(/view=referrals/);
  await expect(page).not.toHaveURL(/demo=|trainingAssessment=|trainingIntake=/);
  await expect(page.locator('[data-pipeline-demo-banner="true"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("referral intake practice saves locally without creating or updating a live referral", async ({ page }) => {
  const writes = watchWorkflowWrites(page);
  await page.goto(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&trainingIntake=1&demo=1`);
  await page.locator('[data-workspace-field="name"] input').fill("Synthetic Intake Test");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect(page.getByTestId("workspace-save-status")).toContainText("Practice changes saved in this tab");
  await expect(page).not.toHaveURL(/referralId=/);
  expect(writes).toEqual([]);
});

test("Help scheduling records a synthetic appointment and opens the same practice assessment", async ({ page }) => {
  const writes = watchWorkflowWrites(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open guided tutorials", exact: true }).click();
  await page.getByRole("dialog", { name: "Guided tutorial library" }).getByRole("button", { name: /^Schedule an assessment/ }).click();
  const coach = page.getByRole("dialog", { name: "Schedule an assessment guided tutorial", exact: true });
  const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await expect(coach.getByRole("heading", { name: "Set the appointment" })).toBeVisible();
  const date = schedule.getByLabel("Assessment date and time");
  await date.fill("2027-10-14T09:30");
  await date.blur();
  await schedule.getByLabel("Assessment method").selectOption("zoom");
  await schedule.getByLabel("Zoom meeting link").fill("https://example.invalid/pipeline-practice");
  await schedule.getByRole("button", { name: "Schedule interview", exact: true }).click();
  await expect(page).toHaveURL(/trainingAssessment=guided.*assessmentSection=identity/);
  await expect(schedule).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-assessment-view="assessment"]')).toBeVisible();
  await expect(coach.getByRole("heading", { name: "Open the assessment" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("all twelve assessment sections are reachable without filling or signing anything", async ({ page }) => {
  const writes = watchWorkflowWrites(page);
  await page.goto(practice);
  const sections = page.getByRole("combobox", { name: "Assessment section", exact: true });
  const keys = ["identity", "diagnosis_clinical", "prior_placement", "prior_history", "functional_adl", "medication", "substance_use", "behavioral_risk", "physical_health", "legal_conservatorship", "social_support", "provenance_qc"];
  await expect(sections.locator("option")).toHaveCount(12);
  const values = await sections.locator("option").evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value));
  expect(new Set(values).size).toBe(12);
  expect(values).toEqual(expect.arrayContaining(keys));
  for (const key of keys) {
    await sections.selectOption(key);
    await expect(sections).toHaveValue(key);
    await expect(page.locator('[data-assessment-question-editor]')).toBeVisible();
  }
  expect(writes).toEqual([]);
});
