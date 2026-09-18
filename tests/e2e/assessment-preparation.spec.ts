import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { assessmentPreparationGroups, preparationGroupForSection, preparationQuestions } from "../../lib/assessment/assessment-preparation";
import { assessmentInterviewQuestions, assessmentInterviewSections, getRequiredAssessmentInterviewQuestions } from "../../lib/assessment/assessment-interview-schema";
import { createEmptyAssessmentToolData } from "../../lib/assessment/assessment-tool-schema";
import { assessmentWorkingCounts } from "../../components/pipeline/assessment-working-view";
import type { AxeResults } from "axe-core";

test("preparation uses canonical questions, preserves conditions, and excludes interview-only findings", () => {
  const fields = assessmentPreparationGroups.flatMap((group) => group.fields);
  expect(new Set(fields).size).toBe(fields.length);
  for (const field of fields) expect(assessmentInterviewQuestions.some((question) => question.field === field)).toBe(true);
  for (const section of assessmentInterviewSections) expect(preparationGroupForSection(section.key).sections).toContain(section.key);
  for (const field of ["current_symptoms", "cognition_orientation", "current_self_harm_ideation", "active_substance_use", "substance_use_insight", "overall_hygiene_rating", "peer_interaction_rating", "placement_preferences_concerns"]) expect(fields).not.toContain(field);
  const data = createEmptyAssessmentToolData();
  const daily = preparationGroupForSection("functional_adl");
  expect(preparationQuestions(daily, data).some((question) => question.field === "mobility")).toBe(false);
  data.ambulatory = "no";
  const mobility = preparationQuestions(daily, data).find((question) => question.field === "mobility");
  expect(mobility).toBe(assessmentInterviewQuestions.find((question) => question.field === "mobility"));
  expect(getRequiredAssessmentInterviewQuestions(data)).toContain(mobility);
  expect(assessmentWorkingCounts([mobility!], { ...data, mobility: "Extracted walker detail" }, ["mobility"])).toMatchObject({ captured: 0, verify: 1 });
});

async function createReferral(page: Page) {
  const name = `Preparation ${randomUUID().slice(0, 8)}`;
  const response = await page.request.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: "provisional:allo:annette",
    referral: { name, date: "2026-09-17", stage: "New", community: "San Pablo", county: "Contra Costa County",
      source: "Synthetic referral", priority: "standard", tags: [], documentName: "", documentStatus: "Missing",
      owner: "Annette Everhart", note: "", createdAt: new Date().toISOString(), dob: "1980-04-12",
      phone: "", email: "", payer: "", requirements: [] },
  } });
  expect(response.status()).toBe(201);
  return (await response.json()).referral as { id: number; name: string };
}

async function choosePreparationGroup(page: Page, label: string, key: string) {
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole("combobox", { name: "Preparation group", exact: true }).selectOption(key);
  else await page.getByRole("navigation", { name: "Preparation groups" }).getByRole("button", { name: new RegExp(label) }).click();
  await expect(page.getByRole("article", { name: "Referral preparation worksheet" })).toBeVisible();
}

async function openWorkspacePage(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: new RegExp(label) }).click();
}

async function reviewFullAssessment(page: Page) {
  await choosePreparationGroup(page, "Legal & supports", "legal_conservatorship");
  await page.getByRole("button", { name: "Review assessment", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Assessment interview", exact: true })).toBeVisible();
}

for (const width of [1440, 768]) {
  test(`referral preparation survives switching, quick exit, reload, and beginning the same assessment at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 950 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const referral = await createReferral(page);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
    await openWorkspacePage(page, "Questionnaire");
    const notebook = page.locator("[data-assessment-view]");
    const pages = page.getByRole("navigation", { name: "Client file pages" });
    await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toBeVisible();
    await expect(page.getByTestId("workspace-identity-title")).toHaveText(referral.name);
    await expect(page.getByTestId("preparation-client-folder").locator(":scope > strong")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Assessment interview", exact: true })).toHaveCount(0);
    await expect(pages).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Workspace files", exact: true })).toBeVisible();
    await expect(notebook.getByRole("button", { name: "Open assessment", exact: true })).toBeInViewport();
    await expect(page.getByTestId("workspace-save-status")).toHaveCount(0);
    await notebook.locator('summary[aria-label="More assessment actions"]').click();
    await notebook.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    const schedule = page.locator('[data-assessment-scheduling="fullscreen"]');
    await expect(schedule).toBeVisible();
    const closeSchedule = schedule.getByRole("button", { name: /Close/ });
    // The real pointer action detects toolbar overlap, unlike visibility alone.
    await closeSchedule.click();
    await expect(schedule).toHaveCount(0);
    await expect(notebook.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await expect(notebook.locator("#assessment-resident_name")).toHaveValue(referral.name);
    await expect(notebook.locator("#assessment-date_of_birth")).toHaveValue("1980-04-12");
    await expect(notebook.locator("#assessment-current_symptoms")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`preparation-entry-${width}.png`) });
    const location = notebook.locator("#assessment-current_location");
    await location.fill("Synthetic referring facility");
    await choosePreparationGroup(page, "Clinical history", "prior_history");
    const secondary = notebook.locator("#assessment-secondary_diagnoses");
    await secondary.fill("Documented secondary diagnosis from the synthetic referral.");
    await notebook.getByRole("heading", { name: "Clinical history", exact: true }).click();
    // Beginning or entering the full questionnaire must not create another record.
    const records = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
    expect(records.assessments).toHaveLength(1);
    const assessmentId = records.assessments[0].assessment_id;
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessmentId}`)).json()).assessment.secondary_diagnoses).toEqual(["Documented secondary diagnosis from the synthetic referral."]);
    await choosePreparationGroup(page, "Daily support", "functional_adl");
    await notebook.getByRole("group", { name: "Ambulatory", exact: true }).getByRole("button", { name: "No", exact: true }).click();
    const device = notebook.locator("#assessment-mobility");
    await expect(device).toBeVisible();
    await device.fill("Uses a walker according to the referral.");
    // Exit directly from the last edited field, without waiting for an autosave timer.
    await openWorkspacePage(page, "Intake");
    await expect(notebook).toHaveCount(0);
    await openWorkspacePage(page, "Questionnaire");
    await choosePreparationGroup(page, "Daily support", "functional_adl");
    await expect(device).toHaveValue("Uses a walker according to the referral.");
    await page.reload();
    await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toBeVisible();
    await expect(device).toHaveValue("Uses a walker according to the referral.");
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessmentId}`)).json()).assessment.mobility).toBe("Uses a walker according to the referral.");
    for (const group of assessmentPreparationGroups) await choosePreparationGroup(page, group.label, group.key);
    await choosePreparationGroup(page, "Clinical history", "prior_history");
    await expect(secondary).toHaveValue("Documented secondary diagnosis from the synthetic referral.");
    await secondary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`preparation-${width}.png`) });
    expect(await notebook.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await notebook.locator('summary[aria-label="More assessment actions"]').click();
    await notebook.getByRole("button", { name: "Begin assessment", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
    await begin.getByRole("button", { name: "Record start", exact: true }).click();
    await expect(begin).toHaveCount(0);
    await expect(page.getByTestId("preparation-client-folder")).toBeVisible();
    await expect(secondary).toHaveValue("Documented secondary diagnosis from the synthetic referral.");
    await notebook.getByRole("button", { name: "Return to assessment", exact: true }).click();
    await expect(pages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(notebook.getByRole("button", { name: "Review chart", exact: true })).toBeVisible();
    const reference = notebook.getByRole("complementary", { name: "Captured assessment answers" });
    if (width < 760) await reference.getByRole("button", { name: /^Captured answers/ }).click();
    await reference.getByRole("combobox", { name: "Reference information" }).selectOption("prior_history");
    await expect(reference).toContainText("Documented secondary diagnosis from the synthetic referral.");
    await reference.evaluate((element) => element.setAttribute("data-reference-retained", "true"));
    await notebook.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("functional_adl");
    if (width < 760) await expect(reference.getByRole("button", { name: /^Captured answers/ })).toHaveAttribute("aria-expanded", "true");
    await expect(reference.getByRole("combobox", { name: "Reference information" })).toHaveValue("prior_history");
    await expect(reference).toHaveAttribute("data-reference-retained", "true");
    await expect(reference).toContainText("Documented secondary diagnosis from the synthetic referral.");
    await reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
    await expect(secondary).toBeFocused();
    await secondary.fill("Updated during the interview.");
    await pages.getByRole("button", { name: "Prepare", exact: true }).click();
    await expect(secondary).toHaveValue("Updated during the interview.");
    await notebook.getByRole("button", { name: "Return to assessment", exact: true }).click();
    await page.reload();
    await expect(pages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
    const saved = (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
    expect(saved).toHaveLength(1);
    expect(saved[0].assessment_id).toBe(assessmentId);
    expect(saved[0].started_at).toBeTruthy();
    expect(saved[0].secondary_diagnoses).toEqual(["Updated during the interview."]);
    expect(saved[0].current_location).toBe("Synthetic referring facility");
    expect(saved[0].current_self_harm_ideation).toBeNull();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
  });
}

for (const width of [1440, 768]) {
  test(`integrated preparation preserves the last answer through workspace controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createReferral(page);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
    // Enter through the real workspace tab, not the separate notes-lab route.
    await openWorkspacePage(page, "Questionnaire");
    await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toBeVisible();
    const { assessments } = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
    expect(assessments).toHaveLength(1);
    const id = assessments[0].assessment_id;
    for (const destination of ["Files", "Activity", "Intake"]) {
      const value = `Last answer before ${destination}`;
      await page.locator("#assessment-current_location").fill(value);
      if (destination === "Files" || destination === "Activity") {
        await page.getByRole("button", { name: `Workspace ${destination.toLowerCase()}`, exact: true }).click();
      } else {
        await openWorkspacePage(page, destination);
      }
      await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toHaveCount(0);
      await expect.poll(async () => (await (await page.request.get(`/api/assessments/${id}`)).json()).assessment.current_location).toBe(value);
      await openWorkspacePage(page, "Questionnaire");
      await expect(page.locator("#assessment-current_location")).toHaveValue(value);
    }
    await reviewFullAssessment(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Assessment interview", exact: true })).toHaveCount(0);
    await expect(page.locator("#packet-page-1")).toBeVisible();
    await openWorkspacePage(page, "Questionnaire");
    await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open questionnaire", exact: true })).toHaveCount(0);
    // Escape on an inline file page must not close or collapse it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toBeVisible();
  });
}

test("preparation remains keyboard navigable and motion-free with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const referral = await createReferral(page);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  const worksheet = page.getByRole("article", { name: "Referral preparation worksheet" });
  await expect(worksheet).toHaveCSS("animation-name", "none");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const view = width < 640 ? page.locator("[data-phone-interview]") : worksheet;
    await expect(view).toBeVisible();
    expect(await view.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    const result = await axe.run('[aria-label="Workspace stages"], [aria-label="Preparation groups"]', { runOnly: ["color-contrast", "button-name"] });
    return result.violations.map(({ id }) => id);
  });
  expect(violations).toEqual([]);
  const pages = page.getByRole("navigation", { name: "Client file pages" });
  await choosePreparationGroup(page, "Legal & supports", "legal_conservatorship");
  await page.getByRole("button", { name: "Review assessment", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(worksheet).toHaveCount(0);
  await pages.getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(worksheet).toBeVisible();
  await choosePreparationGroup(page, "Referral & placement", "identity");
  await page.getByRole("button", { name: "Next group", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinical history", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Referral & placement", exact: true })).toBeVisible();
});

test("preparation stays editable after signing and preserves the sent assessment's read-only boundary", async ({ page }) => {
  const referral = await createReferral(page);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Signed synthetic diagnosis"] },
  } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  const signed = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: {
    if_match: assessment.version, client_mutation_id: randomUUID(),
  } });
  expect(signed.status()).toBe(200);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  const notebook = page.locator("[data-assessment-view]");
  await notebook.getByRole("navigation", { name: "Client file pages" }).getByRole("button", { name: "Prepare", exact: true }).click();
  await choosePreparationGroup(page, "Clinical history", "prior_history");
  await expect(notebook.locator("#assessment-secondary_diagnoses")).toHaveValue("Signed synthetic diagnosis");
  await expect(notebook.locator("#assessment-secondary_diagnoses")).toBeEditable();
  await expect(notebook.getByRole("checkbox", { name: "Bipolar disorder", exact: true })).toBeEnabled();
  await notebook.locator("#assessment-secondary_diagnoses").fill("Corrected before sending");
  await notebook.getByRole("heading", { name: "Clinical history", exact: true }).click();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await expect.poll(async () => (await read()).secondary_diagnoses).toEqual(["Corrected before sending"]);
  // Presentation fixture; the real delivery boundary is covered by the local/PostgreSQL fixtures.
  await page.route(`**/api/referrals/${referral.id}/assessments*`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.assessments = body.assessments.map((item: { assessment_id: string; version: number }) => item.assessment_id === assessment.assessment_id
      ? { ...item, meet_client_sent_at: "2026-09-18T13:00:00.000Z", meet_client_sent_version: item.version }
      : item);
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await notebook.getByRole("navigation", { name: "Client file pages" }).getByRole("button", { name: "Prepare", exact: true }).click();
  await choosePreparationGroup(page, "Clinical history", "prior_history");
  await expect(notebook.locator("#assessment-secondary_diagnoses")).toHaveValue("Corrected before sending");
  await expect(notebook.locator("#assessment-secondary_diagnoses")).toHaveAttribute("readonly");
  await expect(notebook.getByRole("checkbox", { name: "Bipolar disorder", exact: true })).toBeDisabled();
  await expect(notebook.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
  expect((await read()).secondary_diagnoses).toEqual(["Corrected before sending"]);
});

test.describe("queued preparation recovery", () => {
  // Playwright must own the intercepted writes even in a desktop-enabled build.
  test.use({ serviceWorkers: "block" });
  test("a queued preparation save stays visible and keeps answers across views", async ({ page }) => {
    const referral = await createReferral(page);
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    let rejectedWrites = 0;
    await page.route(`**/api/assessments/${assessment.assessment_id}`, async (route) => {
      if (route.request().method() === "PATCH") { rejectedWrites += 1; await route.fulfill({ status: 503, json: { error: "Synthetic save temporarily unavailable" } }); }
      else await route.continue();
    });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    const notebook = page.locator("[data-assessment-view]");
    const location = notebook.locator("#assessment-current_location");
    await location.fill("Unsaved but retained referral notes");
    await notebook.getByRole("heading", { name: "Referral & placement", exact: true }).click();
    await expect.poll(() => rejectedWrites).toBeGreaterThan(0);
    await expect(notebook.locator('[data-guide-target="assessment-save-status"]')).toHaveText("1 change waiting to sync");
    expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_location).not.toBe("Unsaved but retained referral notes");
    const pages = notebook.getByRole("navigation", { name: "Client file pages" });
    await reviewFullAssessment(page);
    await pages.getByRole("button", { name: "Prepare", exact: true }).click();
    await choosePreparationGroup(page, "Referral & placement", "identity");
    await expect(location).toHaveValue("Unsaved but retained referral notes");
    await expect(notebook.locator('[data-guide-target="assessment-save-status"]')).not.toHaveText("All changes saved");
    await page.unroute(`**/api/assessments/${assessment.assessment_id}`);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_location).toBe("Unsaved but retained referral notes");
    await expect(notebook.locator('[data-guide-target="assessment-save-status"]')).toHaveText("Offline changes synced");
    await location.fill("Recovered referral notes");
    await notebook.getByRole("heading", { name: "Referral & placement", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_location).toBe("Recovered referral notes");
  });
});

test("extracted preparation answers retain their source and verification state", async ({ page }) => {
  const referral = await createReferral(page);
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].secondary_diagnoses = ["Synthetic extracted diagnosis"];
    payload.assessments[0].field_provenance.secondary_diagnoses = [{
      source_field_key: "secondary_diagnoses", source_file: "Synthetic referral.pdf", confidence: 0.8,
      review_status: "pending", source_page_no: 2, evidence_url: null,
    }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  const field = page.locator('[data-assessment-preparation] [data-working-field="secondary_diagnoses"]');
  await expect(field).toContainText("Synthetic referral.pdf");
  await expect(field).toContainText("Review");
  await expect(field.getByRole("button", { name: "Use", exact: true })).toBeVisible();
  await expect(field.getByRole("button", { name: "Reject", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Preparation groups" })).toContainText("1 to verify");
  await page.unrouteAll({ behavior: "wait" });
});
