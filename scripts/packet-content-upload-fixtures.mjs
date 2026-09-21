import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

export async function packetContentUploadResults() {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-packet-content-"));
  const name = "identical file content permits independent referrals and edits while Save retries stay idempotent";
  try {
    const globals = {
      process: Object.assign(Object.create(process), { env: {
        ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: "disconnected",
        PIPELINE_DATABASE_URL: "", PIPELINE_REFERRAL_STORE_MODE: "local_file",
        PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"),
        PIPELINE_ASSESSMENT_STORE_MODE: "local_file",
        PIPELINE_ASSESSMENT_STORE_PATH: join(directory, "assessments.json"),
        PIPELINE_DEMO_MODE: "false", NEXT_PUBLIC_PIPELINE_PERSONA_DEMO: "false",
      } }),
    };
    const store = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-store.ts", globals);
    const actor = { id: "packet-content-fixture", name: "Fixture Assessor" };
    const documentHash = "a".repeat(64);
    const input = (clientName, hash = documentHash) => ({
      name: clientName, date: "9/16/2026", stage: "New", community: "Turlock",
      county: "Stanislaus County", source: "Fixture", priority: "standard",
      tags: [], owner: actor.name, ownerId: actor.id, note: "", createdAt: "2026-09-16T00:00:00Z",
      dob: "1/1/1980", phone: "", email: "", payer: "", documentHash: hash,
    });
    const first = await store.createReferral(input("Content Fixture Alpha"), "content-first", actor);
    const second = await store.createReferral(input("Content Fixture Beta"), "content-second", actor);
    assert.notEqual(first.referral.id, second.referral.id);
    assert.equal(second.referral.documentHash, documentHash);
    const replay = await store.createReferral(input("Content Fixture Beta"), "content-second", actor);
    assert.equal(replay.referral.id, second.referral.id);
    assert.equal(replay.idempotentReplay, true);
    const third = await store.createReferral(input("Content Fixture Gamma", "b".repeat(64)), "content-third", actor);
    const patched = await store.patchReferral(third.referral.id, { documentHash }, third.referral.version, actor);
    assert.equal(patched.ok, true);
    assert.equal(patched.referral.documentHash, documentHash);
    await store.softDeleteReferral(first.referral.id, actor, first.referral.version);
    const restarted = await store.createReferral(input("Content Fixture Alpha"), "content-restarted", actor);
    assert.notEqual(restarted.referral.id, first.referral.id);
    const sameName = await store.createReferral(input("Content Fixture Alpha"), "same-name-alert", actor);
    assert.notEqual(sameName.referral.id, restarted.referral.id);
    assert.notEqual(sameName.referral.clientId, restarted.referral.clientId);
    assert(sameName.warnings.some((warning) => warning.includes("saved separately")));
    const assessments = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-store.ts", globals);
    const schema = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts", globals);
    const completion = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-completion.ts", globals);
    const created = await assessments.createAssessment({
      referral_id: sameName.referral.id, assigned_assessor: actor,
      data: schema.createEmptyAssessmentToolData(),
      field_provenance: { primary_diagnosis: [{ review_status: "pending" }] },
    }, actor, "incomplete-assessment");
    assert.equal(created.ok, true, `Assessment create: ${JSON.stringify(created)}`);
    const signed = await assessments.patchAssessment(created.assessment.assessment_id,
      { signer: actor }, actor, { expectedVersion: created.assessment.version, mutationId: "sign-with-alerts" });
    assert.equal(signed.ok, true, `Assessment sign: ${JSON.stringify(signed)}`);
    assert(signed.assessment.signed_at);
    assert.equal(signed.assessment.started_at, null);
    assert.equal(signed.assessment.primary_diagnosis, null);
    assert(completion.getAssessmentCompletionSummary(signed.assessment).missing.length > 0);
    assert(signed.warnings.some((warning) => warning.code === "assessment_data_incomplete"));
    assert(signed.warnings.some((warning) => warning.code === "assessment_extraction_unreviewed"));
    await verifyMissingWorkflowDetails(store, input, actor, globals);
    const workflow = loadTypeScriptModule(process.cwd(), "lib/pipeline/workflow-store.ts", globals);
    const latest = await workflow.getReferralWorkflowSnapshot(sameName.referral.id);
    const recommendation = await workflow.recordAssessmentRecommendation(sameName.referral.id,
      { assessmentId: signed.assessment.assessment_id, outcome: "decline", reasonNote: "" },
      latest.referral.version, latest.referral.sectionVersions.decision, actor);
    assert.equal(recommendation.ok, true, `Recommendation: ${JSON.stringify(recommendation)}`);
    const forDecision = await workflow.getReferralWorkflowSnapshot(sameName.referral.id);
    const decision = await workflow.recordAdmissionDecision(sameName.referral.id,
      { outcome: "accepted", reasonNote: "" }, forDecision.referral.version,
      forDecision.referral.sectionVersions.decision, actor);
    assert.equal(decision.ok, true, `Decision: ${JSON.stringify(decision)}`);
    const forAdmission = await workflow.getReferralWorkflowSnapshot(sameName.referral.id);
    const admitted = await workflow.transitionReferral(sameName.referral.id, "Accepted / Admitted",
      forAdmission.referral.version, forAdmission.referral.sectionVersions.workflow, actor, undefined, "2026-09-16");
    assert.equal(admitted.ok, true, `Admission: ${JSON.stringify(admitted)}`);
    assert.equal(admitted.referral.admissionDate ?? "", "");
    assert.equal(admitted.referral.actualAdmissionDate, "2026-09-16");
    return [{ name, ok: true }, { name: "matching names and incomplete assessments progress through signing, review and explicit admission without invented answers", ok: true }];
  } catch (error) {
    return [{ name, ok: false, error: String(error.message ?? error) }];
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyMissingWorkflowDetails(store, input, actor, globals) {
  const created = await store.createReferral({
    ...input("Missing Details Fixture"), owner: "Unassigned", ownerId: undefined, documentStatus: "Missing",
    requirements: [{ id: "8f650e15-89eb-4fad-aa34-0e5bc11c149e", type: "tb_test", label: "TB test", status: "needed", requiredFor: "move_in", owner: "Unassigned", dueAt: "", nextStep: "", blocker: true, version: 1 }],
  }, "missing-details", actor);
  const authorization = { mode: "manual_chart", reason: "", authorizedBy: actor.id, authorizedByName: actor.name, authorizedAt: "2026-09-16T12:00:00.000Z" };
  const authorized = await store.patchReferral(created.referral.id, { manualIntakeAuthorization: authorization }, created.referral.version, actor);
  assert.equal(authorized.ok, true, JSON.stringify(authorized));
  const status = loadTypeScriptModule(process.cwd(), "lib/pipeline/workflow-status.ts", globals);
  assert.equal(status.hasManualIntakeAuthorization(authorized.referral), true);
  assert.equal(authorized.referral.manualIntakeAuthorization.reason, "");
  assert.equal(authorized.referral.documentStatus, "Missing");
  const workflow = loadTypeScriptModule(process.cwd(), "lib/pipeline/workflow-store.ts", globals);
  const advanced = await workflow.transitionReferral(created.referral.id, "Packet Needed", authorized.referral.version, authorized.referral.sectionVersions.workflow, actor);
  assert.equal(advanced.ok, true, JSON.stringify(advanced));
  assert.equal(advanced.referral.owner, "Unassigned");
  for (const requirementStatus of ["requested", "waived", "unavailable", "not_applicable"]) {
    const snapshot = await workflow.getReferralWorkflowSnapshot(created.referral.id);
    const item = snapshot.work_items[0];
    const changed = await workflow.patchReferralWorkItem(created.referral.id, item.id, {
      status: requirementStatus, requestedFrom: "", followUpAt: "", dueAt: "", nextStep: "", waiverReason: "", unavailableReason: "",
    }, item.version, actor);
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.equal(changed.record.status, requirementStatus);
    assert.equal(changed.record.nextStep, "");
    assert.equal(changed.record.dueAt, "");
    assert.equal(changed.record.followUpAt, undefined);
    assert.equal(changed.record.waiverReason, undefined);
    assert.equal(changed.record.unavailableReason, undefined);
  }
}
