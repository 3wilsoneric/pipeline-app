import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

test("a failed optional contact read does not stop scheduling a partial referral", async () => {
  const actor = { id: "assessor", name: "Synthetic Assessor", roles: ["reviewer"] };
  const assessment = { assessment_id: "partial", referral_id: 42, assessor_id: actor.id, version: 1 };
  const patches = [];
  const route = loadEntry("app/api/assessments/[assessmentId]/schedule/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => ({ ok: true, user: actor }) },
    "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => actor },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _path, handler) => handler() },
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async () => ({ ok: true, referral: { id: 42, name: "", dob: "", source: "", community: "San Pablo" } }) },
    "@/lib/pipeline/contact-store": {
      requireContactStore: () => ({ ok: true }),
      getContactSchedulingReadiness: async () => { throw new Error("Synthetic contact service outage"); },
    },
    "@/lib/assessment/assessment-store": {
      requireAssessmentStore: () => ({ ok: true }), getAssessment: async () => assessment,
      patchAssessment: async (...args) => { patches.push(args); return { ok: true, assessment: { ...assessment, scheduled_start_at: args[1].schedule.start_at } }; },
    },
  });
  const response = await route.POST(new Request("http://localhost/api/assessments/partial/schedule", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ if_match: 1, client_mutation_id: "schedule-partial", schedule: { status: "scheduled", start_at: "2026-10-01T18:00:00Z", duration_minutes: 30, method: "record_review" } }),
  }), { params: Promise.resolve({ assessmentId: "partial" }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(patches.length, 1);
  assert.match(result.warnings.join(" "), /contacts are unavailable/);
  assert.equal(result.assessment.scheduled_start_at, "2026-10-01T18:00:00Z");
});
