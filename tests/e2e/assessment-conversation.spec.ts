import { expect, test, type Page } from "@playwright/test";
import { assessmentAnswerOrigin, assessmentQuestionStatus, assessmentWorkingSections } from "../../components/pipeline/assessment-working-view";
import { buildTrainingAssessment } from "../../lib/training/mock-assessment";
import type { AxeResults } from "axe-core";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";
import { editPreparedAnswer } from "./support/assessment-navigation";

const practice = "/?view=referrals&screen=packet&trainingAssessment=prepare&demo=1&workspaceStage=assessment&assessmentSection=diagnosis_clinical";

async function beginInterview(page: Page) {
  await page.getByRole("region", { name: "Assessment progress", exact: true }).getByRole("button", { name: "Interview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Begin interview", exact: true })).toHaveCount(0);
}

test("preparation uses the same conditional answers without treating source acceptance as client confirmation", () => {
  const data = buildTrainingAssessment("prepare");
  const prepared = assessmentWorkingSections(data, [], true);
  expect(prepared).toHaveLength(5);
  expect(assessmentWorkingSections(data, [])).toHaveLength(12);
  const fields = prepared.flatMap((group) => group.questions.map((question) => question.field));
  expect(fields).toContain("current_symptoms");
  expect(fields).toContain("current_self_harm_ideation");
  expect(fields).toContain("secondary_diagnoses");
  data.im_injections = "yes";
  expect(assessmentWorkingSections(data, [], true).flatMap((group) => group.questions.map((q) => q.field))).toContain("im_injections_details");
  data.im_injections = "no";
  expect(assessmentWorkingSections(data, [], true).flatMap((group) => group.questions.map((q) => q.field))).not.toContain("im_injections_details");
  data.secondary_diagnoses = ["Synthetic record detail"];
  data.field_provenance.secondary_diagnoses = [{ source_field_key: "secondary_diagnoses", source_file: "Referral.pdf", source_page_no: 2, confidence: 0.9, review_status: "pending", evidence_url: null }];
  const question = prepared.flatMap((group) => group.questions).find((q) => q.field === "secondary_diagnoses")!;
  expect(assessmentQuestionStatus(question, data, ["secondary_diagnoses"])).toBe("verify");
  expect(assessmentAnswerOrigin(data, data, "secondary_diagnoses")).toBe("Source: Referral.pdf · page 2");
  data.field_provenance.secondary_diagnoses[0].review_status = "accepted";
  expect(assessmentAnswerOrigin(data, data, "secondary_diagnoses")).not.toMatch(/confirmed|verified/i);
  expect(assessmentAnswerOrigin(data, { ...data, secondary_diagnoses: ["Changed during interview"] }, "secondary_diagnoses")).toBe("Updated in this session");
});

for (const width of [1440, 820]) {
  test(`records and interview share a stable reference at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(practice);
    const folder = page.getByTestId("assessment-client-folder");
    const progress = folder.getByRole("region", { name: "Assessment progress", exact: true });
    const reference = folder.getByRole("complementary", { name: "Current information" });
    const editor = folder.locator("[data-assessment-question-editor]");
    await expect(progress.locator('[aria-current="step"]')).toHaveText("1Prepare assessment");
    await expect(folder.getByRole("heading", { name: /From the records|Ask & confirm/ })).toHaveCount(0);
    await expect(folder.getByLabel("Assessment section", { exact: true })).toHaveValue("prior_history");
    await expect(reference).toHaveCount(0);
    await expect(editor.locator('[data-working-field="current_symptoms"]')).toBeVisible();
    const field = editor.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    const answer = "Synthetic history prepared before meeting the client.";
    await field.fill(answer);
    await expect(field).toBeFocused();
    await field.press("Tab");
    await expect(field).toHaveValue(answer);
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("medication");
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    await expect(field).toBeEditable();
    await editPreparedAnswer(page, "Secondary diagnosis");
    await expect(field).toHaveValue(answer);
    await expect(reference).toHaveCount(0);
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("medication");
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    await page.screenshot({ path: info.outputPath(`prepare-${width}.png`) });
    await beginInterview(page);
    await expect(progress.locator('[aria-current="step"]')).toHaveText("2Interview");
    await expect(progress.getByRole("button", { name: "All questions", exact: true })).toBeEnabled();
    await expect(folder.getByLabel("Assessment section", { exact: true })).toHaveValue("prior_history");
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("diagnosis_clinical");
    const sectionNavigation = folder.getByRole("navigation", { name: "Assessment sections" });
    await expect(editor.getByRole("navigation", { name: "Assessment sections" })).toHaveCount(0);
    await expect(sectionNavigation).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const navigationWidth = (await sectionNavigation.boundingBox())!.width;
    const editorWidth = (await editor.boundingBox())!.width;
    if (width >= 960) expect(navigationWidth).toBeGreaterThan(editorWidth);
    else expect(navigationWidth).toBeCloseTo(editorWidth, 0);
    await expect(reference).toContainText(answer);
    await expect(field).toHaveCount(0);
    const current = reference.getByRole("button", { name: "Edit Current symptoms", exact: true });
    if (width < 960) await reference.getByRole("button", { name: /^Current information/ }).click();
    await current.click();
    const interview = editor.getByRole("textbox", { name: "Current symptoms", exact: false });
    await interview.fill("Synthetic change described by the client today.");
    if (width >= 960) await expect(current).not.toContainText("Synthetic change described");
    else await expect(current).toBeHidden(); // Tablet reference closes when editing.
    await interview.press("Tab");
    if (width < 960) await reference.getByRole("button", { name: /^Current information/ }).click();
    await expect(current).toContainText("Synthetic change described by the client today.");
    await expect(interview).toBeVisible();
    // Section changes retain the latest field without waiting for autosave.
    await interview.fill("Synthetic final sentence before switching.");
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    await expect(folder.getByRole("region", { name: "Recent care and history questions", exact: true })).toBeVisible();
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("diagnosis_clinical");
    await expect(folder.getByRole("region", { name: "How things are now questions", exact: true })).toBeVisible();
    if (width < 960 && await reference.getByRole("button", { name: /^Current information/ }).getAttribute("aria-expanded") === "false") await reference.getByRole("button", { name: /^Current information/ }).click();
    await expect(current).toContainText("Synthetic final sentence before switching.");
    await expect(folder.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Verify the start of the page turn too, not just the settled reference.
    const readingPage = reference.locator('[data-assessment-reference-page]');
    await readingPage.evaluate((element) => { for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = 0; } });
    await expect(readingPage).toHaveCSS("opacity", "1");
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Assessment progress"], [data-assessment-working-section]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
    });
    expect(violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`interview-${width}.png`), animations: "disabled" });
  });
}

test("small preparation screens scroll instructions away and keep group navigation reachable", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 540 });
  await page.goto(practice);
  const folder = page.getByTestId("assessment-client-folder");
  const field = folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeInViewport();
  await expect(folder.getByRole("region", { name: "Assessment progress" })).not.toBeInViewport();
  await expect(folder.getByRole("navigation", { name: "Assessment section steps" })).toBeInViewport();
  await field.fill("Synthetic short-screen preparation note");
  await folder.getByRole("button", { name: "Next section", exact: true }).click();
  await expect(folder.getByLabel("Assessment section", { exact: true })).toBeInViewport();
  await expect(folder.getByRole("region", { name: "Assessment progress" })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("short-preparation-screen.png") });
});

test("incomplete preparation opens the interview and returns to all questions without a start gate", async ({ page }) => {
  await page.goto(practice);
  const folder = page.getByTestId("assessment-client-folder");
  const picker = folder.getByLabel("Assessment section", { exact: true });
  await expect(picker.locator("option")).toHaveCount(5);
  await folder.getByLabel("Assessment section", { exact: true }).selectOption("legal_conservatorship");
  const next = folder.getByRole("navigation", { name: "Assessment section steps" }).getByRole("button", { name: "Open interview", exact: true });
  await next.click();
  await expect(page.getByRole("dialog", { name: "Begin interview", exact: true })).toHaveCount(0);
  await expect(picker.locator("option")).toHaveCount(12);
  await folder.getByRole("button", { name: "All questions", exact: true }).click();
  await expect(picker.locator("option")).toHaveCount(5);
  await beginInterview(page);
  await expect(folder.getByLabel("Assessment section", { exact: true }).locator("option")).toHaveCount(12);
  await expect(folder.getByLabel("Assessment section", { exact: true })).toHaveValue("legal_conservatorship");
  await expect(page.getByRole("dialog", { name: "Begin interview", exact: true })).toHaveCount(0);
  await expect(folder.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
});

test("preparation persists in the same assessment without starting or signing an encounter", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Conversation ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic referral history"] } } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  const folder = page.getByTestId("assessment-client-folder");
  await expect(folder.getByLabel("Assessment section", { exact: true }).locator("option")).toHaveCount(5);
  await expect(folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true })).toBeEditable();
  await editPreparedAnswer(page, "Secondary diagnosis");
  await folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true }).fill("Synthetic amended history from records");
  await folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true }).blur();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await expect.poll(async () => (await read()).secondary_diagnoses).toEqual(["Synthetic amended history from records"]);
  await page.reload();
  await expect(folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true })).toBeEditable();
  await editPreparedAnswer(page, "Secondary diagnosis");
  await expect(folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true })).toHaveValue("Synthetic amended history from records");
  const stored = await read();
  expect(stored.started_at).toBeNull();
  expect(stored.signed_at).toBeNull();
  expect(stored.current_symptoms).toBeNull();
  const list = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
  expect(list.assessments).toHaveLength(1);
  await beginInterview(page);
  expect((await read()).started_at).toBeNull();
  await folder.getByLabel("Assessment section", { exact: true }).selectOption("diagnosis_clinical");
  await expect(folder.getByRole("complementary", { name: "Current information" })).toContainText("Synthetic amended history from records");
  await page.reload();
  await expect(folder.getByLabel("Assessment section", { exact: true }).locator("option")).toHaveCount(12);
  await expect(folder.getByRole("button", { name: "Begin interview", exact: true })).toBeEnabled();
  expect((await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments).toHaveLength(1);
});

for (const width of [390, 320]) {
  test(`phone preparation and reference return to the same interview at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(practice);
    const folder = page.getByTestId("assessment-client-folder");
    const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await expect(folder.locator('[data-assessment-phase="preparation"]')).toBeVisible();
    await expect(folder.locator('[data-phone-interview]')).toHaveCount(0);
    const field = folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await field.fill("Synthetic diagnosis from referral notes.");
    const reference = page.getByRole("dialog", { name: "Client information", exact: true });
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("medication");
    await folder.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
    await expect(field).toBeEditable();
    await editPreparedAnswer(page, "Secondary diagnosis");
    await expect(field).toHaveValue("Synthetic diagnosis from referral notes.");
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`phone-prepare-${width}.png`), animations: "disabled" });
    await beginInterview(page);
    await folder.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await sections.getByRole("button", { name: /^2\. How things are now/ }).click();
    await folder.getByRole("button", { name: "Client info", exact: true }).click();
    await expect(reference).toContainText("Synthetic diagnosis from referral notes.");
    await expect(reference).toContainText("During the practice interview");
    await reference.getByRole("button", { name: "Close information panel" }).click();
    await expect(folder.getByRole("navigation", { name: "Question steps" }).getByRole("button").last()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-interview-${width}.png`), animations: "disabled" });
  });
}

test("interview remains editable when the retired start service is unavailable", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Interview access ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic prepared diagnosis"] } } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  let startRequests = 0;
  await page.route("**/api/assessments/*/start", (route) => { startRequests++; return route.fulfill({ status: 503, json: { error: "Synthetic start unavailable" } }); });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  await beginInterview(page);
  await page.getByLabel("Assessment section", { exact: true }).selectOption("diagnosis_clinical");
  await expect(page.getByRole("complementary", { name: "Current information" })).toContainText("Synthetic prepared diagnosis");
  const field = page.locator("#assessment-current_symptoms");
  await field.fill("Synthetic answer while start service is unavailable");
  await field.blur();
  await expect.poll(async () => (await read()).current_symptoms).toBe("Synthetic answer while start service is unavailable");
  await page.getByRole("button", { name: "All questions", exact: true }).click();
  await beginInterview(page);
  await page.reload();
  await expect(page.getByLabel("Assessment section", { exact: true }).locator("option")).toHaveCount(12);
  const saved = await read();
  expect(saved.current_symptoms).toBe("Synthetic answer while start service is unavailable");
  expect(saved.started_at).toBeNull();
  expect(saved.signed_at).toBeNull();
  expect(startRequests).toBe(0);
  expect((await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments).toHaveLength(1);
});

test("late recovery restores answers without moving the assessor back to an older section", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Late recovery ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  const { assessment } = await response.json();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  await page.route(`**/api/me/assessment-drafts/${assessment.assessment_id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    reads += 1;
    await delayed;
    await route.fulfill({ json: { version: 1, draft: {
      schema: 1, assessmentId: assessment.assessment_id, referralId: referral.id,
      savedAt: new Date(Date.now() + 1000).toISOString(), baseVersion: assessment.version,
      sectionVersions: assessment.section_versions, dirtySections: ["medication"],
      activeSection: "prior_history", baseData: assessment,
      data: { ...assessment, medications_at_intake: ["Synthetic recovered medication note"] },
    } } });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await expect.poll(() => reads).toBeGreaterThan(0);
  const picker = page.getByLabel("Assessment section", { exact: true });
  await picker.selectOption("medication");
  await expect(picker).toHaveValue("medication");
  release();
  await expect(page.getByRole("button", { name: "Recorded answers: 1 of 19", exact: true })).toBeVisible();
  await editPreparedAnswer(page, "Medications at intake");
  await expect(page.locator('#assessment-medications_at_intake')).toHaveValue("Synthetic recovered medication note");
  await expect(picker).toHaveValue("medication");
});
