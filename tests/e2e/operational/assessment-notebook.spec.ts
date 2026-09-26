import { expect, test } from "@playwright/test";

import { actorApiContext, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, signOperationalAssessment } from "../support/operational-api";

// Interview notebook (docs/design/DECISIONS.md, "Interview notebook"): part of the assessment record,
// saved per heading with its own version, independent of the answers, locked once signed.
test.describe("assessment interview notebook", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with the operational Playwright configuration and an isolated store.",
  );

  test("saves per heading, never disturbs answers, guards versions, and locks at signing", async ({ baseURL }) => {
    const base = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", base);
    const assessor = await actorApiContext("assessorA", base);
    const otherAssessor = await actorApiContext("assessorB", base);
    const viewer = await actorApiContext("viewer", base);
    const outsider = await actorApiContext("outsider", base);
    try {
      for (const context of [assessor, otherAssessor, coordinator, viewer]) expect((await context.get("/api/members")).status()).toBe(200);
      const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
      const assessment = await createOperationalAssessment(assessor, referral.id);
      const notebook = `/api/assessments/${assessment.assessment_id}/notebook`;
      const block = (key: string) => `${notebook}/${encodeURIComponent(key)}`;
      const versionOf = async () => (await (await assessor.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.version as number;

      const before = await versionOf();
      const first = await assessor.put(block("before"), { data: { body: "Called county liaison.\nFace sheet coming Mon. ", if_match: 0 } });
      expect(first.status(), await first.text()).toBe(200);
      expect((await first.json()).block).toMatchObject({ block_key: "before", body: "Called county liaison.\nFace sheet coming Mon. ", version: 1 });
      const topic = await assessor.put(block("topic:medication"), { data: { body: "Client says meds changed last week", if_match: 0 } });
      expect(topic.status()).toBe(200);
      // Notes never change the assessment's own version, so they can't make an answer save conflict.
      expect(await versionOf()).toBe(before);

      // Anyone who can open the referral reads the notes; an outsider can't.
      const read = await coordinator.get(notebook);
      expect(read.status()).toBe(200);
      expect(((await read.json()).blocks as { block_key: string }[]).map((item) => item.block_key).sort()).toEqual(["before", "topic:medication"]);
      expect([403, 404]).toContain((await outsider.get(notebook)).status());
      // Notes follow the assessment's own edit rule (every Pipeline role may edit a workspace it can open);
      // someone who can't open the referral can neither read nor write them.
      expect((await viewer.get(notebook)).status()).toBe(200);
      expect([403, 404]).toContain((await outsider.put(block("before"), { data: { body: "No access", if_match: 1 } })).status());
      const colleague = await otherAssessor.put(block("collateral"), { data: { body: "Colleague: spoke with sister", if_match: 0 } });
      expect(colleague.status()).toBe(200);
      expect((await colleague.json()).block.updated_by_name).toBe("Assessor B");

      // A stale version gets the current block back instead of overwriting it.
      const stale = await assessor.put(block("before"), { data: { body: "Older screen", if_match: 0 } });
      expect(stale.status()).toBe(409);
      expect((await stale.json()).block).toMatchObject({ body: "Called county liaison.\nFace sheet coming Mon. ", version: 1 });
      expect((await assessor.put(block("before"), { data: { body: "Called county liaison twice.", if_match: 1 } })).status()).toBe(200);

      for (const data of [
        { body: "x".repeat(20_001), if_match: 2 },
        { body: "bell\u0007", if_match: 2 },
        { body: 42, if_match: 2 },
        { body: "ok", if_match: -1 },
        { body: "ok" },
      ]) expect((await assessor.put(block("before"), { data })).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
      expect((await assessor.put(block("not-a-heading"), { data: { body: "ok", if_match: 0 } })).status()).toBe(400);

      // Signing locks the notebook with the record.
      await signOperationalAssessment(assessor, await completeOperationalAssessment(assessor, await createOperationalAssessmentIfNeeded()));
      const locked = await assessor.put(block("before"), { data: { body: "After signing", if_match: 2 } });
      expect(locked.status()).toBe(423);
      expect((await (await assessor.get(notebook)).json()).locked).toBe(true);

      async function createOperationalAssessmentIfNeeded() {
        return (await (await assessor.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
      }
    } finally {
      await Promise.all([coordinator.dispose(), assessor.dispose(), otherAssessor.dispose(), viewer.dispose(), outsider.dispose()]);
    }
  });
});
