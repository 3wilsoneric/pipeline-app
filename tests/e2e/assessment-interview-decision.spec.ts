import { openAssessmentChart } from "./support/assessment-navigation";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

async function createInterview(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Conversation ${randomUUID().replace(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: {
      language_barrier: "yes", language_barrier_details: "Synthetic interpreter arranged; allow pauses.",
      ambulatory: "no", mobility: "Synthetic walker; offer a seated conversation.",
      current_self_harm_ideation: "no", current_safety_measures: "Hidden stale answer must not be surfaced.",
      secondary_diagnoses: ["Synthetic documented diagnosis"], current_symptoms: "Synthetic current concern",
      prior_placements: "Synthetic earlier placement", medications_at_intake: ["Synthetic medication"],
    },
  } });
  expect(response.status()).toBe(201);
  const { assessment } = await response.json();
  return { referral, assessment, url: `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical` };
}

for (const width of [1440, 390]) {
  test(`quick recommendation is reversible, persists and does not admit or send at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const { referral, assessment, url } = await createInterview(page);
    const read = async () => (await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json());
    await page.goto(url);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    const more = page.locator('summary[aria-label="Assessment details"]');
    await more.click();
    const recommendation = page.getByRole("combobox", { name: "Placement recommendation" });
    await expect(recommendation).toBeEnabled();
    await expect(recommendation.locator("option")).toHaveText(["Select recommendation", "Accept", "Deny", "Under review"]);
    for (const [label, outcome] of [["Accept", "accept"], ["Under review", "needs_more_information"], ["Deny", "decline"]]) {
      await recommendation.selectOption({ label });
      await expect.poll(async () => (await read()).recommendation?.outcome).toBe(outcome);
      await expect(recommendation).toHaveValue(outcome);
      await expect(recommendation).toBeEnabled();
      await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
    }
    let failedMutationId = "";
    await page.route(`**/api/referrals/${referral.id}/recommendation`, (route) => {
      failedMutationId = route.request().postDataJSON().client_mutation_id;
      return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } });
    });
    await recommendation.selectOption("accept");
    await expect(page.locator("[data-quick-recommendation]").getByRole("alert")).toContainText("Synthetic save unavailable");
    await expect(recommendation).toHaveValue("decline");
    await page.unroute(`**/api/referrals/${referral.id}/recommendation`);
    const retried = page.waitForRequest((request) => request.url().endsWith(`/api/referrals/${referral.id}/recommendation`) && request.method() === "PUT");
    await recommendation.selectOption("needs_more_information");
    expect((await retried).postDataJSON().client_mutation_id).not.toBe(failedMutationId);
    await expect.poll(async () => (await read()).recommendation?.outcome).toBe("needs_more_information");
    await page.screenshot({ path: info.outputPath(`recommendation-${width}.png`) });
    const workflow = await read();
    expect(workflow.decision).toBeNull();
    expect(workflow.review).toBeNull();
    expect(workflow.referral.admissionDate).toBeFalsy();
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeNull();
    expect(saved.started_at).toBeNull();
    expect(saved.meet_client_sent_at).toBeFalsy();
    await page.reload();
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    await more.click();
    await expect(recommendation).toHaveValue("needs_more_information");
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/referrals/${referral.id}/recommendation`, async (route) => { await gate; await route.continue(); });
    try {
      await recommendation.selectOption("accept");
      await more.click();
      await openAssessmentChart(page);
      await footer.getByRole("button", { name: "Review assessment", exact: true }).click();
      await expect(footer.getByRole("button", { name: "Saving recommendation...", exact: true })).toBeDisabled();
    } finally { release(); }
    await expect(footer.getByRole("button", { name: "Sign & continue to decision", exact: true })).toBeEnabled();
    await expect.poll(async () => (await read()).recommendation?.outcome).toBe("accept");
    expect((await read()).review).toBeNull();
  });
}

test("current information follows only the active section and keeps unverified sources marked", async ({ page }, info) => {
  const { referral, url } = await createInterview(page);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].field_provenance.secondary_diagnoses = [{ source_field_key: "secondary_diagnoses", source_file: "Synthetic referral.pdf", confidence: 0.8, review_status: "pending", source_page_no: 2, evidence_url: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(url);
  await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
  const reference = page.getByRole("complementary", { name: "Current information" });
  await expect(reference.getByRole("combobox")).toHaveCount(0);
  await expect(reference).not.toContainText("Synthetic interpreter arranged");
  await expect(reference).not.toContainText("Synthetic walker");
  await expect(reference).not.toContainText("Hidden stale answer");
  await expect(reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true })).toContainText("Needs verification");
  await expect(reference).not.toContainText("Synthetic earlier placement");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
  await expect(reference).toContainText("Synthetic earlier placement");
  await expect(reference).not.toContainText("Synthetic documented diagnosis");
  await expect(reference).not.toContainText("Synthetic interpreter arranged");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("prior_placement");
  await expect(reference).not.toContainText("Synthetic earlier placement");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("medication");
  await expect(reference).not.toContainText("Synthetic documented diagnosis");
  await expect(reference).toContainText("Synthetic medication");
  await page.screenshot({ path: info.outputPath("conversation-context.png") });
});
