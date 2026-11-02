import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";
import { editPreparedAnswer, openAllQuestions, openAssessmentChart, returnToAssessmentQuestions, waitForAssessmentReady } from "./support/assessment-navigation";

test("workspace restores before accepting the first assessment edit", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic recovery entry", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  let release = () => {};
  const recovery = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/me/referral-drafts/*", async (route) => {
    if (route.request().method() === "GET") await recovery;
    await route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=diagnosis_clinical&assessmentQuestion=current_symptoms`);
    const workspace = page.getByTestId("packet-workspace");
    const answer = page.locator("#assessment-current_symptoms");
    await expect(answer).toBeVisible();
    await expect(workspace).toHaveAttribute("inert", "");
    await answer.evaluate((element) => element.focus());
    await expect(answer).not.toBeFocused();
    release();
    await waitForAssessmentReady(page);
    await answer.click();
    await answer.fill("Synthetic first answer after restoring the workspace.");
    await answer.blur();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_symptoms)
      .toBe("Synthetic first answer after restoring the workspace.");
  } finally { release(); }
});

for (const width of [1440, 390]) test(`full questionnaire stays editable during an interview and returns to the same question at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic full questionnaire", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  const started = await read();
  const starts: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.method() === "POST" && /\/(start|schedule)$/.test(new URL(request.url()).pathname)) starts.push(request.url()); });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=diagnosis_clinical&assessmentQuestion=current_symptoms`);
  await waitForAssessmentReady(page);
  const symptoms = page.locator("#assessment-current_symptoms");
  await symptoms.fill("Synthetic interview observation");
  if (width === 390) {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /All questions/ }).click();
  } else await openAllQuestions(page);
  await expect(page.locator('[data-assessment-working-section][data-assessment-phase="preparation"]')).toBeVisible();
  await expect(symptoms).toHaveValue("Synthetic interview observation");
  await expect.poll(async () => (await read()).current_symptoms).toBe("Synthetic interview observation");
  await page.locator("#assessment-secondary_diagnoses").fill("Synthetic record detail");
  await page.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("identity");
  await page.locator("#assessment-referrer_contact").fill("Synthetic updated contact");
  await page.screenshot({ path: info.outputPath(`all-questions-${width}.png`) });
  await page.getByRole("button", { name: "Continue interview", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Continue interview", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Continue interview", exact: true }).click();
  await expect(symptoms).toHaveValue("Synthetic interview observation");
  await expect.poll(async () => (await read()).referrer_contact).toBe("Synthetic updated contact");
  if (width === 390) {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await sheet.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Referrer contact");
    await sheet.getByRole("button", { name: /Referrer contact/ }).click();
    await expect(page.locator("#assessment-referrer_contact")).toBeFocused();
    await page.locator("#assessment-referrer_contact").fill("Synthetic contact from phone search");
  } else {
    await editPreparedAnswer(page, "Secondary diagnosis");
    await expect(page.locator("#assessment-secondary_diagnoses")).toBeFocused();
    await page.locator("#assessment-secondary_diagnoses").fill("Synthetic corrected record detail");
  }
  await page.getByRole("button", { name: "Continue interview", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Continue interview", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "Continue interview", exact: true }).click();
  await expect(symptoms).toHaveValue("Synthetic interview observation");
  await expect.poll(async () => width === 390 ? (await read()).referrer_contact : (await read()).secondary_diagnoses).toEqual(width === 390 ? "Synthetic contact from phone search" : ["Synthetic corrected record detail"]);
  // Leave a focused, changed answer using real workspace navigation. The chart
  // and the remounted editor must show that answer without losing our question.
  await symptoms.fill("Synthetic updated before switching tabs");
  await openAssessmentChart(page);
  await expect(page.getByRole("article", { name: "Assessment record", exact: true })).toContainText("Synthetic updated before switching tabs");
  await returnToAssessmentQuestions(page);
  await expect(symptoms).toHaveValue("Synthetic updated before switching tabs");
  await symptoms.fill("Synthetic saved before opening files");
  if (width === 390) await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Files" });
  else await page.getByRole("button", { name: "Workspace files", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=files/);
  await returnToAssessmentQuestions(page);
  await expect(symptoms).toHaveValue("Synthetic saved before opening files");
  await page.reload();
  await expect(symptoms).toHaveValue("Synthetic saved before opening files");
  await expect(page.getByRole("button", { name: "Use latest", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`interview-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const saved = await read();
  expect(saved.current_symptoms).toBe("Synthetic saved before opening files");
  expect(saved.started_at).toBe(started.started_at);
  expect(saved.assessment_date).toBe(started.assessment_date);
  expect(starts).toEqual([]);
  expect(errors).toEqual([]);
});
