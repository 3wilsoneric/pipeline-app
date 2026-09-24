import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assessmentPreparationGroups, preparationGroupForSection, preparationQuestions } from "../../lib/assessment/assessment-preparation";
import { assessmentInterviewQuestions, assessmentInterviewSections, getRequiredAssessmentInterviewQuestions } from "../../lib/assessment/assessment-interview-schema";
import { createEmptyAssessmentToolData, type AssessmentToolSection } from "../../lib/assessment/assessment-tool-schema";
import { assessmentWorkingCounts } from "../../components/pipeline/assessment-working-view";
import { createOperationalReferral } from "./support/operational-api";
import { editPreparedAnswer, openAssessmentChart, returnToAssessmentQuestions } from "./support/assessment-navigation";
import type { AxeResults } from "axe-core";

test("source preparation retains canonical questions and conditional fields", () => {
  const fields = assessmentPreparationGroups.flatMap((group) => group.fields);
  expect(new Set(fields).size).toBe(fields.length);
  for (const field of fields) expect(assessmentInterviewQuestions.some((question) => question.field === field)).toBe(true);
  for (const section of assessmentInterviewSections) expect(preparationGroupForSection(section.key).sections).toContain(section.key);
  expect([...fields].sort()).toEqual(assessmentInterviewQuestions.map((question) => question.field).sort());
  const data = createEmptyAssessmentToolData();
  expect(preparationQuestions(preparationGroupForSection("identity"), data).some((question) => question.field === "assessment_date")).toBe(false);
  const daily = preparationGroupForSection("functional_adl");
  expect(preparationQuestions(daily, data).some((question) => question.field === "mobility")).toBe(false);
  data.ambulatory = "no";
  const mobility = preparationQuestions(daily, data).find((question) => question.field === "mobility");
  expect(mobility).toBe(assessmentInterviewQuestions.find((question) => question.field === "mobility"));
  expect(getRequiredAssessmentInterviewQuestions(data)).toContain(mobility);
  expect(assessmentWorkingCounts([mobility!], { ...data, mobility: "Extracted walker detail" }, ["mobility"])).toMatchObject({ captured: 0, verify: 1 });
});

async function createReferral(page: Page) {
  return createOperationalReferral(page.request, "assessmentCoordinator", { name: `Preparation ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart", dob: "1980-04-12" }, { assigneeId: "provisional:allo:annette" });
}
async function openPage(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: new RegExp(`${label}$`) }).click();
}
async function section(page: Page, key: string) {
  const picker = page.getByRole("combobox", { name: "Assessment section", exact: true });
  await picker.selectOption(await picker.locator(`option[value="${key}"]`).count() ? key : preparationGroupForSection(key as AssessmentToolSection).key);
}

for (const width of [1440, 768]) {
  test(`preparation, interview and chart share one folder and saved record at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const referral = await createReferral(page);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
    const header = page.getByTestId("workspace-folder-header");
    await header.evaluate((el) => el.setAttribute("data-retained", "true"));
    await openPage(page, "Assessment");
    const folder = page.getByTestId("assessment-client-folder");
    await expect(folder).toBeVisible();
    await expect(header).toHaveAttribute("data-retained", "true");
    await expect(page.getByTestId("preparation-client-folder")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Client file pages" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open assessment", exact: true })).toHaveCount(0);
    await expect(folder.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await section(page, "identity");
    const reference = folder.getByRole("complementary", { name: "Current information" });
    await expect(reference).toHaveCount(0);
    await expect(page.locator('#assessment-resident_name')).toHaveValue(referral.name!);
    await editPreparedAnswer(page, "Resident name");
    await expect(page.locator('#assessment-resident_name')).toHaveValue(referral.name!);
    await page.locator("#assessment-current_location").fill("Synthetic referring facility");
    await section(page, "diagnosis_clinical");
    const secondary = page.locator("#assessment-secondary_diagnoses");
    await secondary.fill("Documented secondary diagnosis from the referral.");
    await section(page, "functional_adl");
    await folder.getByRole("group", { name: "Ambulatory", exact: true }).getByRole("button", { name: "No", exact: true }).click();
    await page.locator("#assessment-mobility").fill("Uses a walker according to the referral.");
    // Leave the focused field without waiting for the autosave timer.
    await openPage(page, "Chart");
    await openPage(page, "Assessment");
    await section(page, "functional_adl");
    await expect(page.locator('#assessment-mobility')).toHaveValue("Uses a walker according to the referral.");
    await editPreparedAnswer(page, "Type of device");
    await expect(page.locator('#assessment-mobility')).toHaveValue("Uses a walker according to the referral.");
    await page.reload();
    await editPreparedAnswer(page, "Type of device");
    await expect(page.locator('#assessment-mobility')).toHaveValue("Uses a walker according to the referral.");
    await section(page, "diagnosis_clinical");
    await editPreparedAnswer(page, "Secondary diagnosis");
    await expect(secondary).toHaveValue("Documented secondary diagnosis from the referral.");
    await folder.getByRole("button", { name: "Schedule interview", exact: true }).click();
    const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await schedule.getByRole("button", { name: /Close/ }).click();
    await expect(schedule).toHaveCount(0);
    await folder.getByRole("button", { name: "Begin interview", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin interview", exact: true });
    await begin.getByRole("button", { name: "Begin interview", exact: true }).click();
    await expect(begin).toHaveCount(0);
    await expect(page).toHaveURL(/assessmentMode=interview/);
    await section(page, "diagnosis_clinical");
    await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
    await page.locator("#assessment-current_symptoms").fill("Observed during the interview.");
    await openAssessmentChart(page);
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Observed during the interview.");
    await returnToAssessmentQuestions(page);
    await expect(page).toHaveURL(/assessmentMode=interview/);
    await expect(page.getByRole("combobox", { name: "Assessment section" })).toHaveValue("diagnosis_clinical");
    const referenceToggle = reference.getByRole("button", { name: /^Current information/ });
    if (await referenceToggle.isVisible() && await referenceToggle.getAttribute("aria-expanded") === "false") await referenceToggle.click();
    await reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
    await expect(page).toHaveURL(/assessmentMode=prepare/);
    await expect(secondary).toHaveValue("Documented secondary diagnosis from the referral.");
    await secondary.fill("Updated during the interview.");
    await openAssessmentChart(page);
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Updated during the interview.");
    await returnToAssessmentQuestions(page);
    await expect(page).toHaveURL(/assessmentMode=prepare/);
    await expect(page.getByRole("combobox", { name: "Assessment section" })).toHaveValue("prior_history");
    await page.keyboard.press("Escape");
    await expect(folder).toBeVisible();
    const records = (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
    expect(records).toHaveLength(1);
    expect(records[0].started_at).toBeTruthy();
    expect(records[0].secondary_diagnoses).toEqual(["Updated during the interview."]);
    expect(records[0].current_symptoms).toBe("Observed during the interview.");
    expect(records[0].current_location).toBe("Synthetic referring facility");
    expect(records[0].current_self_harm_ideation).toBeNull();
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`one-folder-${width}.png`) });
  });

  test(`files, activity and intake preserve the last answer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const referral = await createReferral(page);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
    await openPage(page, "Assessment");
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    const { assessments } = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
    expect(assessments).toHaveLength(1);
    for (const destination of ["Files", "Activity", "Chart"]) {
      await section(page, "identity");
      await expect(page.locator("#assessment-current_location")).toBeVisible();
      const value = `Last answer before ${destination}`;
      await page.locator("#assessment-current_location").fill(value);
      if (destination === "Chart") await openPage(page, destination);
      else await page.getByRole("button", { name: `Workspace ${destination.toLowerCase()}`, exact: true }).click();
      await expect(page.locator("[data-assessment-working-section]")).toHaveCount(0);
      await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessments[0].assessment_id}`)).json()).assessment.current_location).toBe(value);
      await openPage(page, "Assessment");
    }
  });
}

test("folder tabs support keyboard, small screens and reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const referral = await createReferral(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await openPage(page, "Assessment");
  await expect(page.locator("[data-assessment-question-content]")).toHaveCSS("animation-name", "none");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const folder = page.getByTestId("assessment-client-folder");
    await expect(folder).toBeVisible();
    expect(await folder.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const tab of await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button").all()) await expect(tab).toBeInViewport();
  }
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('[aria-label="Workspace stages"], [aria-label="Assessment sections"]', { runOnly: ["color-contrast", "button-name"] })).violations.map(({ id }) => id);
  });
  expect(violations).toEqual([]);
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart$/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Assessment chart review" })).toBeVisible();
});

test("signed answers stay editable until sent, then become read only", async ({ page }) => {
  const referral = await createReferral(page);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Signed synthetic diagnosis"] } } });
  const { assessment } = await created.json();
  const signed = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
  expect(signed.status()).toBe(200);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  await page.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
  await page.locator("#assessment-secondary_diagnoses").fill("Corrected before sending");
  await page.locator("#assessment-secondary_diagnoses").blur();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await expect.poll(async () => (await read()).secondary_diagnoses).toEqual(["Corrected before sending"]);
  await page.route(`**/api/referrals/${referral.id}/assessments*`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.assessments = body.assessments.map((item: { assessment_id: string; version: number }) => item.assessment_id === assessment.assessment_id ? { ...item, meet_client_sent_at: "2026-09-18T13:00:00.000Z", meet_client_sent_version: item.version } : item);
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Secondary diagnosis" })).toHaveValue("Corrected before sending");
  await expect(page.getByRole("textbox", { name: "Secondary diagnosis" })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "Edit Secondary diagnosis", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Bipolar disorder", exact: true })).toBeDisabled();
  expect((await read()).secondary_diagnoses).toEqual(["Corrected before sending"]);
});

test("queued answers stay visible across chart review and sync after recovery", async ({ page }) => {
  const referral = await createReferral(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await openPage(page, "Assessment");
  await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
  const { assessments } = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
  const id = assessments[0].assessment_id;
  const endpoint = `**/api/assessments/${id}`;
  await page.route(endpoint, (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } }) : route.continue());
  await section(page, "identity");
  await page.locator("#assessment-current_location").fill("Unsaved but retained referral notes");
  await openAssessmentChart(page);
  await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Unsaved but retained referral notes");
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).not.toHaveText("All changes saved");
  expect((await (await page.request.get(`/api/assessments/${id}`)).json()).assessment.current_location).not.toBe("Unsaved but retained referral notes");
  await returnToAssessmentQuestions(page);
  await editPreparedAnswer(page, "Current location");
  await expect(page.locator('#assessment-current_location')).toHaveValue("Unsaved but retained referral notes");
  await page.unroute(endpoint);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // A reconnect during an in-flight replay is picked up by the 10-second retry loop.
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${id}`)).json()).assessment.current_location, { timeout: 15_000 }).toBe("Unsaved but retained referral notes");
});

test("extracted answers retain source and verification controls in the question flow", async ({ page }) => {
  const referral = await createReferral(page);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].secondary_diagnoses = ["Synthetic extracted diagnosis"];
    payload.assessments[0].field_provenance.secondary_diagnoses = [{ source_field_key: "secondary_diagnoses", source_file: "Synthetic referral.pdf", confidence: 0.8, review_status: "pending", source_page_no: 2, evidence_url: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  const field = page.locator('[data-working-field="secondary_diagnoses"]');
  await expect(field).toContainText("Synthetic referral.pdf");
  await expect(field).toContainText("Review");
  await expect(field.getByRole("button", { name: "Use", exact: true })).toBeVisible();
  await expect(field.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });
});
