import { expect, test, type Page } from "@playwright/test";

async function openWorkingAssessment(page: Page, section = "functional_adl") {
  await page.goto(`/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=${section}&demo=1`);
  const assessment = page.locator("[data-assessment-view]");
  await expect(assessment).toBeVisible();
  await expect(assessment).toHaveAttribute("data-assessment-view", "assessment");
  return assessment;
}

async function revealAppNavigation(page: Page) {
  await page.getByRole("button", { name: "Pipeline home", exact: true }).hover();
  await expect(page.getByRole("complementary", { name: "App navigation", exact: true })).toHaveAttribute("data-sidebar-expanded", "true");
}

test("prepares answers before an appointment and finishes the same questionnaire", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=diagnosis_clinical&demo=1");
  const assessment = page.locator("[data-assessment-view]");
  await expect(assessment).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Schedule interview", exact: true })).toHaveCount(0);
  const field = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
  await field.click();
  await expect(field).toBeFocused();
  const answer = "Synthetic diagnosis prepared from referral documents";
  await field.pressSequentially(answer);
  await expect(field).toHaveValue(answer);
  await field.blur();
  await expect(assessment.locator("[data-assessment-question-editor]")).toContainText("Recorded");
  await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
  await expect(field).toHaveValue(answer);
  await page.getByRole("region", { name: "Assessment progress" }).getByRole("button", { name: "Interview", exact: true }).click();
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("diagnosis_clinical");
  await expect(assessment.getByRole("complementary", { name: "Current information" })).toContainText(answer);
  expect(errors).toEqual([]);
});

test("edits captured answers beside remaining questions without folding during autosave", async ({ page }) => {
  const assessment = await openWorkingAssessment(page, "diagnosis_clinical");
  const captured = assessment.getByRole("complementary", { name: "Current information" });
  await expect(captured).toContainText("Schizoaffective disorder");
  await captured.getByRole("button", { name: "Edit Current symptoms", exact: true }).click();
  const field = assessment.getByRole("textbox", { name: "Current symptoms", exact: false });
  const answer = "Synthetic client reports evening anxiety. Facility records and interview agree. Confirm the current support plan.";
  await field.fill(answer);
  await field.blur();
  await expect(assessment.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
  await expect(field).toBeVisible();
  await expect(captured).toContainText(answer);
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("functional_adl");
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("diagnosis_clinical");
  await expect(captured).toContainText(answer);
  await expect(field).not.toBeVisible();
  await captured.getByRole("button", { name: "Edit Current symptoms", exact: true }).click();
  await expect(field).toHaveValue(answer);
  await page.screenshot({ path: "outputs/assessment-working-desktop.png" });
});

test("finds an exact question across sections and preserves answers when revisiting the chart", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assessment = await openWorkingAssessment(page);
  await assessment.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
  const find = page.getByRole("searchbox", { name: "Find a question", exact: true });
  await find.fill("medication refused");
  await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /Medication refused/ }).click();
  const field = assessment.getByRole("textbox", { name: "Medication refused", exact: false });
  await expect(field).toBeInViewport();
  await field.fill("Synthetic medication A");
  await field.blur();
  await expect(assessment.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
  await assessment.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
  await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^Review assessment/ }).click();
  await expect(page.getByRole("region", { name: "Assessment chart review", exact: true })).toContainText("Synthetic medication A");
  await page.getByRole("button", { name: "Back to questions", exact: true }).click();
  await expect(field).toHaveValue("Synthetic medication A");
});

test("keeps conditional follow-ups with their answer and leaves recorded answers in the reference", async ({ page }) => {
  const assessment = await openWorkingAssessment(page, "medication");
  const captured = assessment.getByRole("complementary", { name: "Current information" });
  await captured.getByRole("button", { name: "Edit IM injections", exact: true }).click();
  const choice = assessment.getByRole("group", { name: "IM injections", exact: true });
  await choice.getByRole("button", { name: "Yes", exact: true }).click();
  const followup = assessment.getByRole("textbox", { name: "Injection details", exact: false });
  await followup.fill("Synthetic monthly injection; verify next due date.");
  await choice.getByRole("button", { name: "No", exact: true }).click();
  await expect(followup).not.toBeVisible();
  await choice.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(followup).toHaveValue("Synthetic monthly injection; verify next due date.");
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("functional_adl");
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("medication");
  await expect(choice).not.toBeVisible();
  await expect(captured).toContainText("Synthetic monthly injection; verify next due date.");
});

test("fits desktop, tablet, and phone and resets section scroll", async ({ page }) => {
  const assessment = await openWorkingAssessment(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const phone = viewport.width < 640;
    await expect(page.getByRole("button", { name: phone ? "Back to previous page" : "Pipeline home", exact: true })).toBeInViewport();
    await expect(assessment.getByRole("button", { name: phone ? /^Next/ : "Next section" }).last()).toBeInViewport();
    await expect(assessment.locator('footer[aria-label="Assessment actions"]')).toBeInViewport();
    await expect(assessment.getByRole("group", { name: "Assessment view", exact: true })).toHaveCount(0);
    await expect(assessment.getByRole("region", { name: "Assessment readiness" })).toHaveCount(0);
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  const canvas = page.locator('[data-guide-target="packet-workspace"]');
  await canvas.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await assessment.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
  await expect(assessment.getByLabel("Assessment section", { exact: true })).toHaveValue("prior_history");
  await expect(assessment.getByLabel("Assessment section", { exact: true })).toBeInViewport();
  await expect(assessment.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true })).toBeInViewport();
  await expect.poll(() => canvas.evaluate((element) => element.scrollTop)).toBe(0);
  await page.screenshot({ path: "outputs/assessment-working-mobile.png" });
});

test("captured answers sit beside the unfinished questions with compact section navigation", async ({ page }) => {
  const assessment = await openWorkingAssessment(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    const editor = (await assessment.locator("[data-assessment-question-editor]").boundingBox())!;
    const book = (await assessment.locator("[data-assessment-working-section]").boundingBox())!;
    expect(editor.width).toBeGreaterThan(book.width * 0.5);
    const captured = (await assessment.getByRole("complementary", { name: "Current information" }).boundingBox())!;
    expect(captured.x - book.x).toBeLessThanOrEqual(24);
    expect(captured.x + captured.width).toBeLessThan(editor.x);
    await expect(assessment.getByRole("complementary", { name: "Assessment navigation", exact: true })).toHaveCount(0);
  }
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("identity");
  await expect(assessment.getByRole("combobox", { name: "Assessment section", exact: true }).locator("option:checked")).toHaveText("Confirm the basics");
});

test("app navigation reveals on hover and keyboard focus without moving the form", async ({ page }) => {
  const assessment = await openWorkingAssessment(page);
  const before = await assessment.boundingBox();
  await revealAppNavigation(page);
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeInViewport();
  expect(await assessment.boundingBox()).toEqual(before);
  await assessment.locator("[data-assessment-question-editor]").hover();
  await expect(page.getByRole("complementary", { name: "App navigation", exact: true })).toHaveAttribute("data-sidebar-expanded", "false");
  await page.getByRole("button", { name: "Pipeline home", exact: true }).focus();
  await expect(page.getByRole("complementary", { name: "App navigation", exact: true })).toHaveAttribute("data-sidebar-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(assessment).toBeVisible();
  await expect(page.getByRole("complementary", { name: "App navigation", exact: true })).toHaveAttribute("data-sidebar-expanded", "false");
});

test.describe("touch navigation", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("reveals the header on a real tap and saves on Home navigation", async ({ page }) => {
    const assessment = await openWorkingAssessment(page);
    await page.getByRole("button", { name: /^Open page menu/ }).tap();
    await expect(page.getByRole("dialog", { name: "Pipeline pages", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Close page menu", exact: true }).tap();
    await page.getByRole("button", { name: "Back to previous page", exact: true }).tap();
    await expect(assessment).not.toBeVisible();
    await expect(page.locator('[data-guide-target="home-workspace"]')).toBeVisible();
  });
});

test("shared Home navigation remains usable and saves before leaving the assessment", async ({ page }) => {
  const assessment = await openWorkingAssessment(page, "diagnosis_clinical");
  await assessment.getByRole("complementary", { name: "Current information" }).getByRole("button", { name: "Edit Current symptoms", exact: true }).click();
  await assessment.getByRole("textbox", { name: "Current symptoms", exact: false }).fill("Synthetic edit immediately before navigating home.");
  await revealAppNavigation(page);
  await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
  await expect(assessment).not.toBeVisible();
  await expect(page.locator('[data-guide-target="home-workspace"]')).toBeVisible();
  await expect(page.locator("[data-pipeline-header]")).toHaveCount(1);
  await expect(page.locator("main").first()).not.toHaveCSS("isolation", "isolate");
});

test("profile navigation leaves through the save path and practice help stays in context", async ({ page }) => {
  let assessment = await openWorkingAssessment(page);
  await revealAppNavigation(page);
  await page.getByRole("button", { name: /^Open profile menu for/ }).click();
  await page.getByRole("link", { name: "Settings Your profile and contacts", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(assessment).not.toBeVisible();
  assessment = await openWorkingAssessment(page);
  await expect(page.locator("[data-pipeline-demo-banner]")).toContainText("Practice workspace · synthetic data only");
  await page.getByRole("button", { name: "Open guided tutorials", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tutorials", exact: true })).toBeVisible();
  await expect(assessment).toBeVisible();
});

test("Home uses the warm canvas behind its board deck", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-guide-target="home-workspace"]')).toHaveCSS("background-color", "rgb(238, 238, 231)");
  await expect(page.getByRole("button", { name: "Open current work", exact: true })).toBeVisible();
  await page.screenshot({ path: "outputs/home-working-green.png" });
});

test("phone captured-answer drawer opens an answer directly in the editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assessment = await openWorkingAssessment(page, "diagnosis_clinical");
  await assessment.getByRole("button", { name: "Client info", exact: true }).click();
  await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: "Review Current symptoms", exact: true }).click();
  await assessment.getByRole("textbox", { name: "Current symptoms", exact: false }).click();
  await expect(assessment.getByRole("textbox", { name: "Current symptoms", exact: false })).toBeFocused();
  await expect(assessment.getByRole("textbox", { name: "Current symptoms", exact: false })).toBeInViewport();
});
