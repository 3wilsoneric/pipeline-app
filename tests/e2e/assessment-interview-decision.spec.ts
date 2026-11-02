import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { activeOperationalAssessor, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

async function createInterview(page: Page) {
  const assessor = await activeOperationalAssessor(page.request);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Conversation ${randomUUID().replace(/[^a-z]/g, "")}`, owner: assessor.display_name, tags: [], documentName: "", documentStatus: "Missing",
  }, { assigneeId: assessor.principal_id });
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
    // The early bookmark is available before review and remains reversible.
    await expect(footer.getByRole("combobox", { name: "Working decision" })).toBeEnabled();
    await page.goto(`${url}&assessmentMode=review`);
    const recommendation = page.getByRole("region", { name: "Placement recommendation", exact: true }).getByRole("combobox", { name: "Working decision" });
    await expect(recommendation).toBeEnabled();
    await expect(recommendation.locator("option")).toHaveText(["Choose...", "Accept", "Deny", "Under review"]);
    for (const [label, outcome] of [["Accept", "accept"], ["Under review", "needs_more_information"], ["Deny", "decline"]]) {
      await recommendation.selectOption({ label });
      await expect.poll(async () => (await read()).recommendation?.outcome).toBe(outcome);
      await expect(recommendation).toHaveValue(outcome);
      await expect(recommendation).toBeEnabled();
      if (outcome === "needs_more_information") await page.getByRole("button", { name: "Not now", exact: true }).click();
      await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
    }
    let failedMutationId = "";
    let failedOutcome = "";
    await page.route(`**/api/referrals/${referral.id}/recommendation`, (route) => {
      failedMutationId = route.request().postDataJSON().client_mutation_id;
      failedOutcome = route.request().postDataJSON().outcome;
      return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } });
    });
    await recommendation.selectOption("accept");
    await expect(page.locator("[data-quick-recommendation]").getByRole("alert")).toContainText("Synthetic save unavailable");
    expect(failedOutcome).toBe("accept");
    await expect(recommendation).toHaveValue("accept");
    await expect(page.locator("[data-quick-recommendation]").getByRole("button", { name: "Retry working decision" })).toBeEnabled();
    await expect.poll(async () => (await read()).recommendation?.outcome).toBe("decline");
    await page.unroute(`**/api/referrals/${referral.id}/recommendation`);
    const retried = page.waitForRequest((request) => request.url().endsWith(`/api/referrals/${referral.id}/recommendation`) && request.method() === "PUT");
    await recommendation.selectOption("needs_more_information");
    expect((await retried).postDataJSON().client_mutation_id).not.toBe(failedMutationId);
    await expect.poll(async () => (await read()).recommendation?.outcome).toBe("needs_more_information");
    await page.getByRole("button", { name: "Not now", exact: true }).click();
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
    await expect(recommendation).toHaveValue("needs_more_information");
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/referrals/${referral.id}/recommendation`, async (route) => { await gate; await route.continue(); });
    try {
      await recommendation.selectOption("accept");
      await expect(footer.getByRole("button", { name: "Saving recommendation...", exact: true })).toBeDisabled();
    } finally { release(); }
    await expect(footer.getByRole("button", { name: "Continue to decision", exact: true })).toBeEnabled();
    await expect.poll(async () => (await read()).recommendation?.outcome).toBe("accept");
    expect((await read()).review).toBeNull();
  });
}

test("current information follows only the active section and keeps unverified sources marked", async ({ page }, info) => {
  const { referral, assessment, url } = await createInterview(page);
  await startOperationalAssessment(page.request, assessment);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].field_provenance.current_symptoms = [{ source_field_key: "current_symptoms", source_file: "Synthetic referral.pdf", confidence: 0.8, review_status: "pending", source_page_no: 2, evidence_url: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(url);
  await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
  await page.goto(`${url}&assessmentMode=interview`);
  const reference = page.getByRole("complementary", { name: "Current information" });
  await expect(reference.getByRole("combobox")).toHaveCount(0);
  await expect(reference).not.toContainText("Synthetic interpreter arranged");
  await expect(reference).not.toContainText("Synthetic walker");
  await expect(reference).not.toContainText("Hidden stale answer");
  await expect(reference.getByRole("button", { name: "Edit Current symptoms", exact: true })).toContainText("Needs verification");
  await expect(reference).not.toContainText("Synthetic earlier placement");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
  await expect(reference).toContainText("Synthetic earlier placement");
  await expect(reference).not.toContainText("Synthetic current concern");
  await expect(reference).not.toContainText("Synthetic interpreter arranged");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("prior_placement");
  await expect(reference).not.toContainText("Synthetic earlier placement");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("medication");
  await expect(reference).not.toContainText("Synthetic current concern");
  await expect(reference).toContainText("Synthetic medication");
  await page.screenshot({ path: info.outputPath("conversation-context.png") });
});

// Batch 2, item 5: a concise review before signing, with links back to editable
// sections and plain language about what signing does and does not finalize.
test("review summary links back to editable sections and explains signing", async ({ page }, info) => {
  const { referral, assessment, url } = await createInterview(page);
  await startOperationalAssessment(page.request, assessment);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await page.goto(url);
  // Section progress and the early bookmark remain available while interviewing.
  await expect(page.getByRole("combobox", { name: "Assessment section", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to decision", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Placement recommendation", exact: true })).toBeVisible();

  await page.goto(`${url}&assessmentMode=review`);
  await page.locator("summary").filter({ hasText: /^Answers by section/ }).click();
  const sections = page.getByRole("list", { name: /^Answers by section/ });
  await expect(sections.getByRole("button")).toHaveCount(12);
  await expect(sections.getByRole("button").first()).toContainText("recorded");
  const signing = page.getByRole("region", { name: "What signing does", exact: true });
  await expect(signing).toContainText("The decision and email are separate actions");
  await expect(signing).toContainText("Unanswered items stay unanswered");
  await expect(page.getByRole("region", { name: "Placement recommendation", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("assessment-review-summary.png"), fullPage: true, animations: "disabled" });

  // A section link returns to that editable section; reviewing never signs.
  await sections.getByRole("button").nth(1).click();
  await expect(page).toHaveURL(/workspaceStage=assessment/);
  await expect(page.getByRole("region", { name: "Assessment questions", exact: true })).toBeVisible();
  await expect(page.locator('[data-working-field="diagnosis_categories"] input').first()).toBeFocused();
  // Preparation gaps open preparation; an interview gap opens its question directly.
  await expect(page).toHaveURL(/assessmentMode=prepare/);
  await page.goto(`${url}&assessmentMode=review`);
  await page.locator("summary").filter({ hasText: /^Answers by section/ }).click();
  await page.getByRole("list", { name: /^Answers by section/ }).getByRole("button").filter({ hasText: "Anything else" }).click();
  await expect(page).toHaveURL(/assessmentMode=interview/);
  await expect(page.getByRole("textbox", { name: "Additional information", exact: true })).toBeFocused();
  expect((await read()).signed_at).toBeNull();
  expect((await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toBeNull();
});
