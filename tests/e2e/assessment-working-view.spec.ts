import { expect, test, type Page } from "@playwright/test";

async function openWorkingAssessment(page: Page, section = "functional_adl") {
  await page.goto(`/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=${section}&demo=1`);
  const assessment = page.getByRole("dialog", { name: "Assessment interview", exact: true });
  await expect(assessment).toBeVisible();
  await expect(assessment).toHaveAttribute("data-assessment-view", "chart");
  await expect(page.getByRole("button", { name: "Show app navigation", exact: true })).toBeVisible();
  return assessment;
}

async function revealAppNavigation(page: Page) {
  await page.getByRole("button", { name: "Show app navigation", exact: true }).hover();
  await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "1");
}

test("prepares answers before an appointment and finishes the same questionnaire", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=diagnosis_clinical&demo=1");
  const assessment = page.getByRole("dialog", { name: "Assessment interview", exact: true });
  await expect(assessment.locator("[data-assessment-client-header]")).toContainText("Questionnaire");
  await expect(page.getByRole("dialog", { name: "Schedule assessment", exact: true })).toHaveCount(0);
  const field = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
  await field.click();
  await expect(field).toBeFocused();
  const answer = "Synthetic diagnosis prepared from referral documents";
  await field.pressSequentially(answer);
  await expect(field).toHaveValue(answer);
  await expect(assessment.locator("[data-assessment-question-editor]")).toContainText("Recorded");
  await assessment.getByRole("button", { name: "Begin assessment", exact: true }).click();
  const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await expect(begin).toContainText("Not scheduled");
  await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await expect(begin).toHaveCount(0);
  await expect(field).toHaveValue(answer);
  await expect(assessment.locator("[data-assessment-client-header]")).not.toContainText("Questionnaire");
  await expect(assessment.getByRole("complementary", { name: "Captured assessment answers" })).toContainText(answer);
  expect(errors).toEqual([]);
});

test("edits captured answers beside remaining questions without folding during autosave", async ({ page }) => {
  const assessment = await openWorkingAssessment(page, "diagnosis_clinical");
  const captured = assessment.getByRole("complementary", { name: "Captured assessment answers" });
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

test("finds an exact question across sections and preserves answers when exiting and resuming", async ({ page }) => {
  const assessment = await openWorkingAssessment(page);
  await assessment.locator('summary[aria-label="Find assessment question"]').click();
  const find = assessment.getByRole("searchbox", { name: "Find assessment question" });
  await find.fill("medication refused");
  await assessment.locator('[aria-label="Matching assessment questions"]').getByRole("button", { name: /^Medication refused/ }).click();
  const field = assessment.getByRole("textbox", { name: "Medication refused", exact: false });
  await expect(field).toBeFocused();
  await field.fill("Synthetic medication A");
  await field.blur();
  await expect(assessment.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
  await expect(assessment.getByRole("complementary", { name: "Captured assessment answers" })).toContainText("Synthetic medication A");
  await assessment.getByRole("button", { name: "Back to referral", exact: true }).click();
  await expect(assessment).not.toBeVisible();
  await expect(page.locator('[data-assessment-app-navigation="standard"]')).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Questionnaire|Assessment/ }).click();
  await expect(assessment).toHaveAttribute("data-assessment-view", "chart");
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("medication");
  await expect(assessment.getByRole("complementary", { name: "Captured assessment answers" })).toContainText("Synthetic medication A");
});

test("keeps conditional follow-ups with their answer and leaves recorded answers in the reference", async ({ page }) => {
  const assessment = await openWorkingAssessment(page, "medication");
  const captured = assessment.getByRole("complementary", { name: "Captured assessment answers" });
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
    await expect(assessment.getByRole("button", { name: "Back to referral", exact: true })).toBeInViewport();
    await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "0");
    await expect(assessment.getByRole("heading", { name: "Taylor Rivera", exact: true })).toBeInViewport();
    await expect(assessment.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: "Sign assessment", exact: true })).toBeInViewport();
    await expect(assessment.locator("[data-assessment-client-header]")).toContainText("Taylor Rivera");
    await expect(assessment.getByRole("group", { name: "Assessment view", exact: true })).toHaveCount(0);
    await expect(assessment.getByRole("region", { name: "Assessment readiness" })).toHaveCount(0);
    expect((await assessment.locator("[data-assessment-client-header]").boundingBox())!.height).toBeLessThanOrEqual(56);
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await assessment.locator("main").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await assessment.locator("main").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await assessment.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
  await expect(assessment.getByLabel("Assessment section", { exact: true })).toHaveValue("prior_history");
  await expect(assessment.getByLabel("Assessment section", { exact: true })).toBeInViewport();
  await expect(assessment.getByRole("heading", { name: "Placement trajectory", exact: true }).last()).toBeInViewport();
  await expect.poll(() => assessment.locator("main").evaluate((element) => element.scrollTop)).toBe(0);
  await page.screenshot({ path: "outputs/assessment-working-mobile.png" });
});

test("captured answers sit beside the unfinished questions with compact section navigation", async ({ page }) => {
  const assessment = await openWorkingAssessment(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    const editor = (await assessment.locator("[data-assessment-question-editor]").boundingBox())!;
    expect(editor.width).toBeGreaterThan(viewport.width * 0.5);
    const captured = (await assessment.getByRole("complementary", { name: "Captured assessment answers" }).boundingBox())!;
    expect(captured.x).toBeLessThan(80);
    expect(captured.x + captured.width).toBeLessThan(editor.x);
    await expect(assessment.getByRole("complementary", { name: "Assessment navigation", exact: true })).toHaveCount(0);
  }
  await assessment.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("identity");
  await expect(assessment.getByRole("heading", { name: "Client & referral", exact: true })).toBeAttached();
});

test("app navigation reveals on hover and keyboard focus without moving the form", async ({ page }) => {
  const assessment = await openWorkingAssessment(page);
  const before = await assessment.boundingBox();
  await revealAppNavigation(page);
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeInViewport();
  expect(await assessment.boundingBox()).toEqual(before);
  await assessment.locator("[data-assessment-question-editor]").hover();
  await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "Pipeline home", exact: true }).focus();
  await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(assessment).toBeVisible();
  await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "0");
});

test.describe("touch navigation", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("reveals the header on a real tap and saves on Home navigation", async ({ page }) => {
    const assessment = await openWorkingAssessment(page);
    await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "0");
    await page.getByRole("button", { name: "Show app navigation", exact: true }).tap();
    await expect(page.locator("#pipeline-app-navigation")).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "Pipeline home", exact: true }).tap();
    await expect(assessment).not.toBeVisible();
    await expect(page.locator('[data-assessment-app-navigation="standard"]')).toBeVisible();
  });
});

test("shared Home navigation remains usable and saves before leaving the assessment", async ({ page }) => {
  const assessment = await openWorkingAssessment(page, "diagnosis_clinical");
  await assessment.getByRole("complementary", { name: "Captured assessment answers" }).getByRole("button", { name: "Edit Current symptoms", exact: true }).click();
  await assessment.getByRole("textbox", { name: "Current symptoms", exact: false }).fill("Synthetic edit immediately before navigating home.");
  await revealAppNavigation(page);
  await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
  await expect(assessment).not.toBeVisible();
  await expect(page.locator('[data-guide-target="home-workspace"]')).toBeVisible();
  await expect(page.locator("[data-pipeline-header]")).toHaveCount(1);
  await expect(page.locator("main").first()).not.toHaveCSS("isolation", "isolate");
});

test("profile links and the practice return link leave through the save path", async ({ page }) => {
  let assessment = await openWorkingAssessment(page);
  await revealAppNavigation(page);
  await page.getByRole("button", { name: /^Open profile menu for/ }).click();
  await page.getByRole("link", { name: "Profile settings Account and display preferences", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(assessment).not.toBeVisible();
  assessment = await openWorkingAssessment(page);
  await page.locator("[data-pipeline-demo-banner]").getByRole("link", { name: "Learning Center", exact: true }).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(assessment).not.toBeVisible();
});

test("Home uses a light emerald canvas without recoloring other screens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-guide-target="home-workspace"]')).toHaveCSS("background-color", "rgb(237, 243, 242)");
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
  await page.screenshot({ path: "outputs/home-working-green.png" });
});

test("phone captured-answer drawer opens an answer directly in the editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const assessment = await openWorkingAssessment(page, "diagnosis_clinical");
  const captured = assessment.getByRole("complementary", { name: "Captured assessment answers" });
  await captured.getByRole("button", { name: /^Captured answers/ }).click();
  await captured.getByRole("button", { name: "Edit Current symptoms", exact: true }).click();
  await expect(assessment.getByRole("textbox", { name: "Current symptoms", exact: false })).toBeFocused();
  await expect(assessment.getByRole("textbox", { name: "Current symptoms", exact: false })).toBeInViewport();
});
