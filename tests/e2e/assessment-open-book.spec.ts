import { openAssessmentChart } from "./support/assessment-navigation";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";

const practiceUrl = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=diagnosis_clinical&demo=1";

async function openPractice(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 950 });
  await page.goto(practiceUrl);
  await expect(page.locator("[data-assessment-working-section]")).toBeVisible();
}

async function chooseSection(page: Page, key: string) {
  await page.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption(key);
  // Wait for the selected page to commit before issuing a second native-select change.
  await expect(page).toHaveURL(new RegExp("assessmentSection=" + key));
  await expect(page.locator("[data-assessment-working-section]")).toHaveAttribute("data-assessment-section", key);
}

// Phones have a separate focused interview suite; the narrow open book remains on tablets.
for (const width of [1440, 1024, 768, 640]) {
  test(`open book keeps existing answers readable and unfinished questions stable at ${width}px`, async ({ page }, testInfo) => {
    await openPractice(page, width);
    const book = page.locator("[data-assessment-working-section]");
    const reference = page.getByRole("complementary", { name: "Captured assessment answers" });
    const editor = page.locator("[data-assessment-question-editor]");
    const secondary = editor.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    if (width < 760) await reference.getByRole("button", { name: /^Captured answers/ }).click();
    await reference.getByRole("combobox", { name: "Reference information" }).selectOption("all");
    await expect(reference).toContainText("Taylor Rivera");
    await expect(reference).toContainText("During the practice interview");
    await expect(editor.locator('[data-working-field="current_symptoms"]')).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Remaining assessment questions" })).toHaveCount(0);
    await secondary.fill("Synthetic prepared diagnosis");
    await expect(secondary).toBeFocused();
    await secondary.press("Tab");
    await expect(secondary).toHaveValue("Synthetic prepared diagnosis");
    await expect(editor).toContainText("Recorded");
    await chooseSection(page, "prior_history");
    await chooseSection(page, "diagnosis_clinical");
    await expect(secondary).toHaveCount(0);
    await expect(editor).toContainText("This section is recorded");
    await reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
    await expect(secondary).toBeFocused();
    await expect(secondary).toHaveValue("Synthetic prepared diagnosis");
    await secondary.fill("");
    await chooseSection(page, "prior_history");
    await chooseSection(page, "diagnosis_clinical");
    await expect(secondary).toBeVisible();
    await chooseSection(page, "functional_adl");
    if (width < 760) await reference.getByRole("button", { name: /^Captured answers/ }).click();
    await reference.getByRole("button", { name: "Edit Ambulatory", exact: true }).click();
    await editor.getByRole("group", { name: "Ambulatory", exact: true }).getByRole("button", { name: "No", exact: true }).click();
    const mobility = editor.locator("#assessment-mobility");
    await expect(mobility).toBeVisible();
    // Even an older hidden answer must be shown when its parent answer reveals it.
    await expect(mobility).toHaveValue("The client walked independently during the practice interview; no device or transfer support was reported.");
    await mobility.fill("Uses a walker; needs help on stairs.");
    await expect(mobility).toBeFocused();
    await chooseSection(page, "medication");
    await chooseSection(page, "functional_adl");
    await expect(mobility).toHaveCount(0);
    await expect(reference).toContainText("Uses a walker; needs help on stairs.");
    if (width >= 760) {
      const left = (await reference.boundingBox())!;
      const right = (await editor.boundingBox())!;
      expect(left.x + left.width).toBeLessThan(right.x);
      expect(left.width).toBeGreaterThan(width * 0.3);
      expect(Math.abs(left.y - right.y)).toBeLessThan(2);
      expect(Math.abs(left.height - right.height)).toBeLessThan(2);
      const footer = (await page.locator('footer[aria-label="Assessment actions"]').boundingBox())!;
      expect(Math.abs(left.y + left.height - footer.y)).toBeLessThan(2);
      await expect(reference.getByRole("button", { name: /^Captured answers/ })).toHaveCount(0);
    }
    expect(await book.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await chooseSection(page, "prior_history");
    if (width < 760) await reference.getByRole("button", { name: /^Captured answers/ }).click();
    await reference.getByRole("combobox", { name: "Reference information" }).selectOption("prior_history");
    await page.screenshot({ path: testInfo.outputPath(`open-book-${width}.png`) });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      const result = await axe.run('[data-assessment-working-section], [aria-label="Assessment sections"]', { runOnly: ["color-contrast", "button-name", "label"] });
      return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
    });
    expect(violations).toEqual([]);
  });
}

test("reading pane keeps its place while questions scroll and sections change", async ({ page }, testInfo) => {
  await openPractice(page, 1024);
  const reference = page.getByRole("complementary", { name: "Captured assessment answers" });
  await reference.getByRole("combobox", { name: "Reference information" }).selectOption("all");
  const readingPage = page.locator("[data-assessment-reference-page]");
  const questions = page.locator("[data-assessment-question-page]");
  const symptoms = reference.getByRole("button", { name: "Edit Current symptoms", exact: true });
  await symptoms.scrollIntoViewIfNeeded();
  const original = await symptoms.locator("span").nth(1).textContent();
  await expect(symptoms.locator("span").nth(1)).toHaveCSS("font-size", "18px");
  await expect(symptoms.locator("span").nth(1)).toHaveCSS("white-space", "pre-wrap");
  const readingPosition = await readingPage.evaluate((el) => el.scrollTop);
  expect(readingPosition).toBeGreaterThan(100);
  await chooseSection(page, "prior_history");
  await questions.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await questions.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await readingPage.evaluate((el) => el.scrollTop)).toBe(readingPosition);
  await chooseSection(page, "medication");
  await expect.poll(() => questions.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await readingPage.evaluate((el) => el.scrollTop)).toBe(readingPosition);
  await symptoms.click();
  const field = page.locator("#assessment-current_symptoms");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(original!);
  await expect(field).toHaveCSS("font-size", "17px");
  expect(await readingPage.evaluate((el) => el.scrollTop)).toBe(readingPosition);
  await field.fill(original + "\nFollow-up documented during the interview.");
  await field.press("Tab");
  await expect(symptoms).toContainText("Follow-up documented during the interview.");
  await reference.getByRole("combobox", { name: "Reference information" }).selectOption("prior_history");
  await expect.poll(() => readingPage.evaluate((el) => el.scrollTop)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("reading-desk-1024.png") });
});

test("top menu reveals on hover and keyboard focus; question search jumps to captured answers", async ({ page }) => {
  await openPractice(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const appMenu = page.locator("#pipeline-app-navigation");
  const reveal = page.getByRole("button", { name: "Show app navigation" });
  await page.mouse.move(700, 500);
  await expect(appMenu).toHaveCSS("opacity", "0");
  await page.locator("[data-assessment-nav-edge]").hover({ position: { x: 500, y: 2 } });
  await expect(appMenu).toHaveCSS("opacity", "1");
  await page.mouse.move(700, 500);
  await expect(appMenu).toHaveCSS("opacity", "0");
  await reveal.focus();
  await expect(appMenu).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(appMenu).toHaveCSS("opacity", "0");
  const search = page.locator('summary[aria-label="Find assessment question"]');
  await search.click();
  const input = page.getByRole("searchbox", { name: "Find assessment question" });
  await expect(input).toBeFocused();
  await input.fill("current symptoms");
  await page.locator('[aria-label="Matching assessment questions"]').getByRole("button", { name: /Current symptoms/ }).click();
  await expect(page.locator("#assessment-current_symptoms")).toBeFocused();
  await expect(page.locator("#assessment-current_symptoms")).toContainText("During the practice interview");
  await search.focus();
  await page.keyboard.press("Enter");
  await input.fill("nonexistent question");
  await expect(page.getByRole("status").filter({ hasText: "No matching questions." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Assessment interview", exact: true })).toBeVisible();
});

test("rapid section choices retain the latest destination", async ({ page }) => {
  await openPractice(page, 1024);
  const section = page.getByRole("combobox", { name: "Assessment section", exact: true });
  for (let pass = 0; pass < 8; pass += 1) {
    await chooseSection(page, "prior_history");
    await chooseSection(page, "diagnosis_clinical");
    await expect(section).toHaveValue("diagnosis_clinical");
    await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
    await expect(page.locator("[data-assessment-question-editor]")).toContainText("Secondary diagnosis");
  }
});

test("browser Back and Forward restore the assessment section without bouncing", async ({ page }) => {
  await openPractice(page);
  const section = page.getByRole("combobox", { name: "Assessment section", exact: true });
  await chooseSection(page, "prior_history");
  await expect(page).toHaveURL(/assessmentSection=prior_history/);
  await page.getByRole("button", { name: "Show app navigation" }).click();
  await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
  await expect(page.locator("[data-assessment-working-section]")).toHaveCount(0);
  await page.goBack();
  await expect(section).toHaveValue("prior_history");
  await expect(page).toHaveURL(/assessmentSection=prior_history/);
  await chooseSection(page, "medication");
  await expect(page).toHaveURL(/assessmentSection=medication/);
  await page.goForward();
  await expect(page.locator("[data-assessment-working-section]")).toHaveCount(0);
  await page.goBack();
  await expect(section).toHaveValue("medication");
  await expect(page).toHaveURL(/assessmentSection=medication/);
});

async function createAssessment(page: Page) {
  const response = await page.request.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: "provisional:allo:annette",
    referral: { name: "Open Book " + randomUUID().slice(0, 8), date: "2026-09-17", stage: "New",
      community: "San Pablo", county: "Contra Costa County", source: "Synthetic referral", priority: "standard",
      tags: [], documentName: "", documentStatus: "Missing", owner: "Annette Everhart", note: "",
      createdAt: new Date().toISOString(), dob: "1980-04-12", phone: "", email: "", payer: "", requirements: [] },
  } });
  expect(response.status()).toBe(201);
  const { referral } = await response.json();
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { current_location: "Synthetic referring hospital", secondary_diagnoses: ["Prepared diagnosis"] },
  } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  const started = await page.request.post(`/api/assessments/${assessment.assessment_id}/start`, { data: {
    if_match: assessment.version, client_mutation_id: randomUUID(),
  } });
  expect(started.status()).toBe(200);
  return { referral, assessment };
}

test("unfinished view preserves pending source verification and missing reasons", async ({ page }) => {
  const { referral } = await createAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].field_provenance.secondary_diagnoses = [{
      source_field_key: "secondary_diagnoses", source_file: "Synthetic referral.pdf", confidence: 0.8,
      review_status: "pending", source_page_no: 2, evidence_url: null,
    }];
    payload.assessments[0].current_symptoms = "unable_to_assess";
    payload.assessments[0].unable_to_assess_reasons = {};
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  const editor = page.locator("[data-assessment-question-editor]");
  const field = editor.locator('[data-working-field="secondary_diagnoses"]');
  await expect(field).toContainText("Synthetic referral.pdf");
  await expect(field.getByRole("button", { name: "Use", exact: true })).toBeVisible();
  await expect(field.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await expect(editor.locator('[data-working-field="current_symptoms"]')).toBeVisible();
  const reference = page.getByRole("complementary", { name: "Captured assessment answers" });
  await expect(reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true })).toContainText("Needs verification");
  await expect(reference.getByRole("button", { name: "Edit Current symptoms", exact: true })).toContainText("Reason missing");
});

test("existing imported chart remains available without a new signed assessment", async ({ page }) => {
  const { referral } = await createAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/canvas`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.referral.workspaceStatus = "historical";
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  await expect(stages.getByRole("button", { name: "Chart", exact: true })).toBeVisible();
  await expect(stages.getByRole("button", { name: /Intake|Assessment|Questionnaire/ })).toHaveCount(0);
});

test("an existing signed chart stays available during a later reassessment", async ({ page }) => {
  const { referral, assessment } = await createAssessment(page);
  const latest = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  const signed = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: {
    if_match: latest.version, client_mutation_id: randomUUID(),
  } });
  expect(signed.status()).toBe(200);
  const next = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: {},
  } });
  expect(next.status()).toBe(201);
  expect((await next.json()).assessment.signed_at).toBeNull();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await expect(page.locator("#packet-charts")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart/ })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`Chart appears after signing and the final answer survives quick exit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const { referral, assessment } = await createAssessment(page);
    const root = `/?view=referrals&screen=packet&referralId=${referral.id}`;
    const chart = page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart/ });
    await page.goto(root + "&workspaceStage=intake");
    await expect(page.locator("#packet-page-1")).toBeVisible();
    await expect(chart).toHaveCount(0);
    await page.goto(root + "&workspaceStage=chart");
    await expect(page.locator("#packet-page-1")).toBeVisible();
    await expect(page.locator("#packet-charts")).toHaveCount(0);
    await page.goto(root + "&workspaceStage=assessment&assessmentSection=diagnosis_clinical");
    const reference = page.getByRole("complementary", { name: "Captured assessment answers" });
    if (width < 640) {
      await page.getByRole("button", { name: "Client info", exact: true }).click();
      await page.getByRole("button", { name: "Review Secondary diagnosis", exact: true }).click();
    } else await reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
    const secondary = page.locator("#assessment-secondary_diagnoses");
    await secondary.fill("Final answer before immediate exit");
    await page.getByRole("button", { name: "Back to referral", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Assessment interview", exact: true })).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.secondary_diagnoses).toEqual(["Final answer before immediate exit"]);
    await page.goto(root + "&workspaceStage=assessment&assessmentSection=diagnosis_clinical");
    if (width < 640) {
      await page.getByRole("button", { name: "Client info", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Client information", exact: true })).toContainText("Final answer before immediate exit");
      await page.getByRole("button", { name: "Review Secondary diagnosis", exact: true }).click();
    } else {
      await expect(reference).toContainText("Final answer before immediate exit");
      await reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
    }
    await secondary.fill("Final answer before signing");
    await expect(page.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await openAssessmentChart(page);
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Final answer before signing");
    await page.getByRole("button", { name: "Return to questions", exact: true }).click();
    await expect(secondary).toHaveValue("Final answer before signing");
    if (width < 640) await expect(secondary).toBeInViewport();
    await openAssessmentChart(page);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign assessment", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    await expect(chart).toHaveCount(1);
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.secondary_diagnoses).toEqual(["Final answer before signing"]);
    await page.goto(root + "&workspaceStage=chart");
    await expect(page.locator("#packet-charts")).toBeVisible();
    await expect(chart).toHaveCount(1);
  });
}
