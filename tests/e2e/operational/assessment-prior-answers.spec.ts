import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { actorApiContext, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, signOperationalAssessment } from "../support/operational-api";

// "Last assessment" suggestions (docs/design/DECISIONS.md, "Interview context"): a returning client's
// last signed assessment offers history-type answers, and the server credits a saved answer to it only
// when the value really matches. Anything else still saves, recorded as entered by the person.
test.describe("assessment prior answers", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with the operational Playwright configuration and an isolated store.",
  );

  test("offer a returning client's signed answers and credit only verified reuse", async ({ baseURL }) => {
    const base = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", base);
    const assessor = await actorApiContext("assessorA", base);
    const outsider = await actorApiContext("outsider", base);
    try {
      // First requests register the synthetic people as workspace members.
      expect((await assessor.get("/api/members")).status()).toBe(200);
      expect((await coordinator.get("/api/members")).status()).toBe(200);
      const first = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
      const signed = await signOperationalAssessment(assessor, await completeOperationalAssessment(assessor, await createOperationalAssessment(assessor, first.id)));
      const earlier = (await (await assessor.get(`/api/assessments/${signed.assessment_id}`)).json()).assessment as { assessment_id: string; signed_at: string };
      expect(earlier.signed_at).toBeTruthy();

      const returning = await coordinator.post(`/api/referrals/${first.id}/new-intake`, { data: { client_mutation_id: randomUUID(), assignee_id: pipelineActors.assessorA.id } });
      expect(returning.status(), await returning.text()).toBe(201);
      const second = (await returning.json()).referral as { id: number };
      const current = await createOperationalAssessment(assessor, second.id);

      const offered = await assessor.get(`/api/assessments/${current.assessment_id}/prior-answers`);
      expect(offered.status()).toBe(200);
      const prior = (await offered.json()).prior;
      expect(prior.source.assessment_id).toBe(earlier.assessment_id);
      expect(prior.answers.diagnosis_categories).toEqual(["schizophrenia"]);
      // Current state is always asked fresh.
      expect(prior.answers).not.toHaveProperty("current_symptoms");
      expect(prior.answers).not.toHaveProperty("resident_name");

      const url = `/api/assessments/${current.assessment_id}`;
      let version = current.version;
      const save = async (patch: Record<string, unknown>) => {
        const response = await assessor.patch(url, { data: { if_match: version, client_mutation_id: randomUUID(), patch } });
        const body = await response.json();
        if (response.ok()) version = body.assessment.version;
        return { status: response.status(), body };
      };
      const latestSource = (body: { assessment: { field_provenance: Record<string, { source_field_key: string; source_file: string | null }[]> } }, field: string) =>
        body.assessment.field_provenance[field]?.at(-1);

      // Verified reuse is credited to the earlier signed assessment.
      const reused = await save({ data: { diagnosis_categories: ["schizophrenia"] }, prior_answers: [{ field: "diagnosis_categories", assessment_id: earlier.assessment_id }] });
      expect(reused.status).toBe(200);
      expect(latestSource(reused.body, "diagnosis_categories")).toMatchObject({ source_field_key: "prior_assessment.diagnosis_categories", source_file: `Assessment signed ${earlier.signed_at.slice(0, 10)}` });

      // A changed value, or an assessment that is not this client's, still saves but is credited to the person.
      const edited = await save({ data: { conservatorship_type: "lps" }, prior_answers: [{ field: "conservatorship_type", assessment_id: earlier.assessment_id }] });
      expect(edited.status).toBe(200);
      expect(latestSource(edited.body, "conservatorship_type")?.source_field_key).toBe("manual.conservatorship_type");
      const forged = await save({ data: { prior_placements: "Synthetic recorded value" }, prior_answers: [{ field: "prior_placements", assessment_id: `forged-${randomUUID()}` }] });
      expect(forged.status).toBe(200);
      expect(latestSource(forged.body, "prior_placements")?.source_field_key).toBe("manual.prior_placements");

      // Only history-type answers can be reused, only when the same patch saves them, and the server-only field is refused.
      expect((await save({ data: { current_symptoms: "Synthetic" }, prior_answers: [{ field: "current_symptoms", assessment_id: earlier.assessment_id }] })).status).toBe(400);
      expect((await save({ data: {}, prior_answers: [{ field: "substances", assessment_id: earlier.assessment_id }] })).status).toBe(400);
      expect((await save({ data: { substances: ["x"] }, prior_answer_sources: { substances: { assessment_id: earlier.assessment_id, signed_at: earlier.signed_at, referral_id: first.id } } })).status).toBe(400);

      // The referral intake's current answers are offered too, and credited to the intake only when unchanged.
      expect(prior).toBeTruthy();
      const intake = (await (await assessor.get(`/api/assessments/${current.assessment_id}/prior-answers`)).json()).intake as Record<string, unknown>;
      expect(intake.resident_name).toBeTruthy();
      expect(intake).not.toHaveProperty("assessor");
      const fromIntake = await save({ data: { resident_name: intake.resident_name }, referral_answers: ["resident_name"] });
      expect(fromIntake.status).toBe(200);
      expect(latestSource(fromIntake.body, "resident_name")?.source_field_key).toBe("referral.name");
      const notIntake = await save({ data: { resident_name: "Synthetic Different Name" }, referral_answers: ["resident_name"] });
      expect(notIntake.status).toBe(200);
      expect(latestSource(notIntake.body, "resident_name")?.source_field_key).toBe("manual.resident_name");
      expect((await save({ data: {}, referral_answers: ["county"] })).status).toBe(400);
      expect((await save({ data: { county: "x" }, referral_answer_sources: { county: {} } })).status).toBe(400);

      // Someone who cannot open the referral gets nothing.
      expect([403, 404]).toContain((await outsider.get(`/api/assessments/${current.assessment_id}/prior-answers`)).status());
    } finally {
      await Promise.all([coordinator.dispose(), assessor.dispose(), outsider.dispose()]);
    }
  });
});
