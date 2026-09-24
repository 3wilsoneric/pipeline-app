import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral } from "../support/operational-api";

test.describe("independent assessor workflow steps", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Requires isolated operational stores.");
  test.setTimeout(60_000);

  test("an assessor opens a questionnaire from an empty intake and revisits intake", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      await page.goto("/?view=referrals&screen=packet");
      const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/referrals" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Create referral", exact: true }).click();
      const response = await created;
      expect(response.status(), await response.text()).toBe(201);
      const referral = (await response.json()).referral;
      expect(referral.dob).toBe("");
      expect(referral.documentName).toBe("");
      const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
      await stages.getByRole("button", { name: "Assessment", exact: true }).click();
      const editor = page.locator('[data-assessment-view]');
      await expect(editor).toBeVisible();
      await stages.getByRole("button", { name: "Chart", exact: true }).click();
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toBeEditable();
      await expect(page.getByRole("textbox", { name: "Referrer phone:", exact: true })).toBeEditable();
    } finally { await context.close(); }
  });

  for (const existingDraft of [false, true]) test(`acceptance ${existingDraft ? "during a draft" : "before assessment"} keeps work editable and signing separate`, async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorApiContext("assessorA", url);
    const admin = await actorApiContext("admin", url);
    const { page, context } = await actorPage(browser, "admin", url);
    try {
      const referral = await incompleteReferral(assessor);
      const existing = existingDraft ? await createOperationalAssessment(assessor, referral.id) : null;
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      await page.getByRole("radio", { name: "Accept", exact: true }).check();
      await page.getByRole("button", { name: "Record decision", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: /^Record (acceptance|denial)$/, exact: true }).click();
      await expect.poll(async () => (await workflow(admin, referral.id)).decision?.outcome).toBe("accepted");
      const accepted = await workflow(admin, referral.id);
      expect(accepted.context.assessmentExists).toBe(existingDraft);
      expect(accepted.review).toBeNull();
      expect(accepted.decision.assessmentId ?? null).toBe(existing?.assessment_id ?? null);
      expect(accepted.referral.stage).not.toBe("Accepted / Admitted");
      expect(accepted.referral.ehrHandoff?.status ?? "not_ready").toBe("not_ready");

      const draft = existing ?? await createOperationalAssessment(assessor, referral.id);
      const edited = await assessor.patch(`/api/assessments/${draft.assessment_id}`, { data: {
        if_match: draft.version, client_mutation_id: randomUUID(), patch: { data: { prior_5150_5250_holds: "Added after acceptance with other answers omitted." } },
      } });
      expect(edited.status(), await edited.text()).toBe(200);
      expect((await edited.json()).assessment.signed_at).toBeNull();
      const current = await readOperationalReferral(assessor, referral.id);
      const intake = await assessor.patch(`/api/referrals/${referral.id}`, { data: {
        if_match: current.version, if_match_sections: { identity: current.sectionVersions.identity },
        client_mutation_id: randomUUID(), patch: { phone: "555-0188" },
      } });
      expect(intake.status(), await intake.text()).toBe(200);
      const activity = await (await admin.get(`/api/referrals/${referral.id}/activity`)).text();
      expect(activity).not.toMatch(/assessment_signed|meet_client_email_sent|ehr_handoff_sent/);
      const invalid = await assessor.put(`/api/referrals/${referral.id}/decision`, { data: {} });
      expect(invalid.status()).toBe(400);
      const beforeSign = await (await admin.get(`/api/referrals/${referral.id}/admission-summary`)).json();
      expect(beforeSign.report).toBeNull();
      const acceptedBeforeSigning = await acceptedCount(admin);
      const sign = await assessor.post(`/api/assessments/${draft.assessment_id}/sign`, { data: {
        if_match: (await edited.json()).assessment.version, client_mutation_id: randomUUID(),
      } });
      expect(sign.status(), await sign.text()).toBe(200);
      const signed = (await sign.json()).assessment;
      const summaryResponse = await admin.get(`/api/referrals/${referral.id}/admission-summary`);
      expect(summaryResponse.status(), await summaryResponse.text()).toBe(200);
      const summary = await summaryResponse.json();
      expect(summary.report.assessmentId).toBe(draft.assessment_id);
      expect(summary.report.assessmentVersion).toBe(signed.version);
      expect(summary.report.signed).toBe(true);
      expect(await acceptedCount(admin)).toBe(acceptedBeforeSigning + 1);
      expect(summary.report.meetClient.admissionDate).toBe("");
      expect(summary.email.blockers.join(" ")).toContain("planned admit date before sending Meet the Client");
      expect((await workflow(admin, referral.id)).decision).toEqual(accepted.decision);
      expect(await (await admin.get(`/api/referrals/${referral.id}/activity`)).text()).not.toMatch(/meet_client_email_sent|ehr_handoff_sent/);
    } finally { await context.close(); await assessor.dispose(); await admin.dispose(); }
  });

  test("recommendation and signing are separate durable actions; unsent answers remain editable", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const referral = await incompleteReferral(assessor);
      const draft = await createOperationalAssessment(assessor, referral.id);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
      await page.locator('summary[aria-label="Assessment details"]').click();
      await page.getByRole("combobox", { name: "Placement recommendation", exact: true }).selectOption("accept");
      await expect.poll(async () => (await workflow(assessor, referral.id)).recommendation?.outcome).toBe("accept");
      const recommended = await workflow(assessor, referral.id);
      expect(recommended.review).toBeNull();
      expect(recommended.decision).toBeNull();
      expect(recommended.context.assessmentSigned).toBe(false);
      const edited = await assessor.patch(`/api/assessments/${draft.assessment_id}`, { data: {
        if_match: draft.version, client_mutation_id: randomUUID(), patch: { data: { prior_5150_5250_holds: "Can still edit after recommending acceptance." } },
      } });
      expect(edited.status(), await edited.text()).toBe(200);
      const sign = await assessor.post(`/api/assessments/${draft.assessment_id}/sign`, { data: {
        if_match: (await edited.json()).assessment.version, client_mutation_id: randomUUID(),
      } });
      expect(sign.status(), await sign.text()).toBe(200);
      expect((await sign.json()).assessment.signed_at).toBeTruthy();
      expect((await workflow(assessor, referral.id)).review).toBeNull();
      await page.reload();
      await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
      const afterSign = await workflow(assessor, referral.id);
      expect(afterSign.decision).toBeNull();
      expect(afterSign.review).toBeNull();
      expect(afterSign.recommendation).toEqual(recommended.recommendation);
      const correction = await assessor.patch(`/api/assessments/${draft.assessment_id}`, { data: {
        if_match: (await sign.json()).assessment.version, client_mutation_id: randomUUID(), patch: { data: { prior_5150_5250_holds: "Correction before sending remains editable and audited." } },
      } });
      expect(correction.status(), await correction.text()).toBe(200);
      expect((await correction.json()).assessment.prior_5150_5250_holds).toBe("Correction before sending remains editable and audited.");
      expect((await correction.json()).assessment.version).toBe((await sign.json()).assessment.version + 1);
      const activity = await (await assessor.get(`/api/referrals/${referral.id}/activity`)).text();
      expect(activity).toContain("assessment_updated");
      expect(activity).not.toMatch(/assessment_review_submitted|meet_client_email_sent/);
    } finally { await context.close(); await assessor.dispose(); }
  });
});

async function incompleteReferral(api: APIRequestContext) {
  await api.get("/api/auth/me");
  return createOperationalReferral(api, "assessorA", {
    name: `Incomplete ${randomUUID().replace(/\d/g, "x")}`, dob: "", source: "", phone: "", email: "", documentName: "", note: "",
  });
}

async function workflow(api: APIRequestContext, id: number) {
  const response = await api.get(`/api/referrals/${id}/workflow`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function acceptedCount(api: APIRequestContext) {
  const month = new Date().toISOString().slice(0, 7);
  const response = await api.get(`/api/operations/reports?report_id=assessment_completion&month=${month}`);
  expect(response.status(), await response.text()).toBe(200);
  const report = await response.json();
  return report.report.rows.reduce((total: number, row: { values: { accepted: number } }) => total + Number(row.values.accepted), 0);
}
