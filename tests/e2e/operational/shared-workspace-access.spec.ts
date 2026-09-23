import { confirmReferralFileLabels } from "../support/referral-upload";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { referralCanvasFieldKeys } from "../../../lib/pipeline/referral-types";
import { createCanvas } from "@napi-rs/canvas";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { createOperationalReferral, createOperationalAssessment, readOperationalReferral, recordOperationalAcceptance, submitOperationalRecommendation, signOperationalAssessment } from "../support/operational-api";

test.describe("shared workspace editing", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Isolated operational stores required.");
  for (const actor of ["admin", "assessmentCoordinator", "assessorB", "viewer"] as const) {
    test(`${actor} edits another assessor's work without role promotion`, async ({ baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const owner = await actorApiContext("assessorA", url);
      const api = await actorApiContext(actor, url);
      try {
        await owner.get("/api/members");
        const me = await (await api.get("/api/auth/me")).json();
        expect(me.user.roles).toEqual(pipelineActors[actor].expectedRoles);
        const referral = await createOperationalReferral(api, "assessorA", { documentName: "", dob: "" }, { assigneeId: pipelineActors.assessorA.id });
        expect((await api.get(`/api/referrals/${referral.id}/canvas`)).status()).toBe(200);
        const changed = await api.patch(`/api/referrals/${referral.id}`, { data: {
          if_match: referral.version, client_mutation_id: randomUUID(), patch: { phone: "555-0117", admissionDate: "2026-10-01" },
        } });
        expect(changed.status(), await changed.text()).toBe(200);
        const assessment = await createOperationalAssessment(api, referral.id);
        const recoveryPath = `/api/me/assessment-drafts/${assessment.assessment_id}`;
        const recoveryDraft = { schema: 1, assessmentId: assessment.assessment_id, referralId: referral.id,
          savedAt: new Date().toISOString(), baseVersion: assessment.version, sectionVersions: {},
          dirtySections: [], data: { prior_5150_5250_holds: "Private recovery" }, baseData: {},
        };
        const recovery = await api.put(recoveryPath, { data: { if_match: 0, draft: recoveryDraft } });
        expect(recovery.status(), await recovery.text()).toBe(200);
        expect((await (await owner.get(recoveryPath)).json()).draft).toBeNull();
        expect((await (await api.get(recoveryPath)).json()).draft.data.prior_5150_5250_holds).toBe("Private recovery");
        expect((await api.delete(recoveryPath, { data: { if_match: (await recovery.json()).version } })).status()).toBe(200);
        const referralDraftPath = `/api/me/referral-drafts/new-${randomUUID()}`;
        const referralRecovery = await api.put(referralDraftPath, { data: { if_match: 0, draft: {
          schema: 1, savedAt: new Date().toISOString(), dirtyKeys: ["summary"],
          fields: Object.fromEntries(referralCanvasFieldKeys.map(key => [key, { value: key === "summary" ? "Private referral recovery" : "" }])),
          conserved: "", tagsInput: "", documents: {},
        } } });
        expect(referralRecovery.status(), await referralRecovery.text()).toBe(200);
        expect((await (await owner.get(referralDraftPath)).json()).draft).toBeNull();
        expect((await api.get("/api/me/referral-drafts")).status()).toBe(200);
        expect((await api.delete(referralDraftPath, { data: { if_match: (await referralRecovery.json()).version } })).status()).toBe(200);
        const edited = await api.patch(`/api/assessments/${assessment.assessment_id}`, { data: {
          if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: { prior_5150_5250_holds: `Recorded by ${actor}` } },
        } });
        expect(edited.status(), await edited.text()).toBe(200);
        const draft = (await edited.json()).assessment;
        expect(draft.assessor_id).toBe(pipelineActors.assessorA.id);
        expect(draft.updated_by.id).toBe(pipelineActors[actor].id);
        await submitOperationalRecommendation(api, await readOperationalReferral(api, referral.id), draft);
        await recordOperationalAcceptance(api, await readOperationalReferral(api, referral.id));
        const signed = await signOperationalAssessment(api, draft);
        const signedRecord = (await (await api.get(`/api/assessments/${signed.assessment_id}`)).json()).assessment;
        expect(signedRecord.signed_by.id).toBe(pipelineActors[actor].id);
        const addendum = await owner.post(`/api/assessments/${signed.assessment_id}/addenda`, { data: {
          if_match: signed.version, note: "Synthetic later information from another team member.", reason_code: "later_information",
        } });
        expect(addendum.status(), await addendum.text()).toBe(422);
        const preSendEdit = await owner.patch(`/api/assessments/${signed.assessment_id}`, { data: {
          if_match: signed.version, patch: { data: { assessment_notes: "Synthetic pre-send correction by another team member." } },
        } });
        expect(preSendEdit.status(), await preSendEdit.text()).toBe(200);
        const workflow = await (await api.get(`/api/referrals/${referral.id}/workflow`)).json();
        expect(workflow.decision.decidedBy).toBe(pipelineActors[actor].id);
        expect(workflow.decision.decidedByRole).toBe(pipelineActors[actor].expectedRoles[0]);
        expect(workflow.capabilities.can_update).toBe(true);
        expect(workflow.capabilities.can_email).toBe(true);
        expect((await api.get(`/api/operations/reports?report_id=assessment_completion&month=${new Date().toISOString().slice(0, 7)}`)).status())
          .toBe(actor === "admin" || actor === "assessmentCoordinator" ? 200 : 403);
        const mine = await (await api.get("/api/referrals?scope=mine&limit=100")).json();
        const team = await (await api.get("/api/referrals?scope=team&limit=100")).json();
        expect(team.referrals.some((item: { id: number }) => item.id === referral.id)).toBe(true);
        expect(Array.isArray(mine.referrals)).toBe(true);
      } finally { await owner.dispose(); await api.dispose(); }
    });
  }

  test("viewer-role teammate edits intake, uploads a file, and opens the questionnaire", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const owner = await actorApiContext("assessorA", url);
    const api = await actorApiContext("viewer", url);
    const { page, context } = await actorPage(browser, "viewer", url);
    try {
      await owner.get("/api/members");
      const referral = await createOperationalReferral(owner, "assessorA", { documentName: "", dob: "" });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      const phone = page.getByRole("textbox", { name: "Referrer phone:", exact: true });
      await expect(phone).toBeEnabled();
      await phone.fill("555-0197");
      await phone.blur();
      await expect.poll(async () => (await (await owner.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe("555-0197");
      await page.getByTestId("document-checklist-toggle").click();
      const canvas = createCanvas(160, 60);
      canvas.getContext("2d").fillRect(0, 0, 160, 60);
      await page.getByLabel("Choose referral documents").setInputFiles({ name: "shared-synthetic.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") });
    await confirmReferralFileLabels(page);
      await expect(page.getByRole("region", { name: "Uploaded documents", exact: true }).getByText("Uploaded", { exact: true })).toBeVisible();
      const files = (await (await api.get(`/api/files?referral_id=${referral.id}`)).json()).files;
      const deleted = await api.delete(`/api/files/${files[0].id}`, { data: { confirmed: true } });
      expect(deleted.status(), await deleted.text()).toBe(200);
      await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Assessment", exact: true }).click();
      const editor = page.locator("[data-assessment-view]");
      await expect(editor).toBeVisible();
      await editor.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_history");
      const answer = editor.getByRole("textbox", { name: /Prior 5150/ });
      await expect(answer).toBeEnabled();
      await answer.fill("A teammate can document this answer.");
      await page.getByTestId("workspace-folder-header").getByRole("button", { name: "Workspaces", exact: true }).click();
      await expect(editor).toHaveCount(0);
      const records = (await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
      expect(records).toHaveLength(1);
      expect(records[0].prior_5150_5250_holds).toBe("A teammate can document this answer.");
    } finally { await context.close(); await owner.dispose(); await api.dispose(); }
  });

  test("shared editing still requires initial Pipeline access and same-origin requests", async ({ baseURL, playwright }) => {
    const url = requireOperationalBaseURL(baseURL);
    const outside = await actorApiContext("outsider", url);
    const anonymous = await playwright.request.newContext({ baseURL: url });
    const viewer = await actorApiContext("viewer", url);
    try {
      expect((await outside.get("/api/referrals")).status()).toBe(403);
      expect((await outside.post("/api/referrals", { data: {} })).status()).toBe(403);
      expect((await anonymous.get("/api/referrals")).status()).toBe(401);
      expect((await viewer.post("/api/referrals", { headers: { origin: "https://unrelated.invalid" }, data: {} })).status()).toBe(403);
    } finally { await outside.dispose(); await anonymous.dispose(); await viewer.dispose(); }
  });
});
