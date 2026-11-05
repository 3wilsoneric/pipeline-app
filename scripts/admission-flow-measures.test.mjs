import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEntry } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const reports = loadEntry("lib/pipeline/operations-reporting.ts", {
  "./client-workspace-store": {}, "./client-data-reports": {}, "./contact-store": {},
});

function referral(id, patch = {}) {
  return { id, name: `Client ${id}`, community: "San Pablo", date: "2026-10-01", stage: "Accepted / Admitted",
    actualAdmissionDate: "2026-10-15", admissionDecision: { outcome: "accepted" }, ...patch };
}

test("admission flow uses actual arrival, leaves missing intervals blank, and retains open and cancelled referrals", () => {
  const rows = reports.admissionFlowRows([
    referral(1, { admissionFlow: { readyToMoveInDate: "2026-10-11", holds: [] } }),
    referral(2, { actualAdmissionDate: undefined, stage: "Assessment", plannedAdmissionDate: "2026-10-10", admissionDecision: undefined }),
    referral(3, { actualAdmissionDate: undefined, stage: "Closed", placementCancellation: { cancelledAt: "2026-10-14T12:00:00Z" } }),
    referral(4, { actualAdmissionDate: "2026-10-22" }),
  ], new Map([[1, ["2026-10-03", "2026-10-20"]], [4, []]]),
  new Map([[1, { firstChange: "2026-10-02T12:00:00Z", lastWorkflowChange: "2026-10-11T12:00:00Z", reschedules: 1, handoffs: 2 }]]));
  const byId = new Map(rows.map((row) => [row.referral_id, row.values]));
  assert.equal(byId.get(1).total_days, 14);
  assert.equal(byId.get(1).assessment_days, 2);
  assert.equal(byId.get(1).assessment_to_arrival_days, 12);
  assert.equal(byId.get(1).ready_wait_days, 4);
  assert.equal(byId.get(1).rework, "1 / 2");
  assert.equal(byId.get(2).total_days, null);
  assert.notEqual(byId.get(2).state, "Admitted");
  assert.equal(byId.get(3).state, "Did not move in");
  assert.equal(byId.get(4).assessment_days, null);
  const metrics = reports.reportMetrics("admission_flow", rows);
  assert.equal(metrics.find((item) => item.label === "Actual admissions").value, "2");
  assert.equal(metrics.find((item) => item.label === "Assessment date coverage").value, "1 of 2");
  assert.equal(metrics.find((item) => item.label === "Did not move in").value, "1");
});

test("received-month cohorts retain open cases and exclude arrivals from older cohorts", () => {
  const all = [
    referral(1, { date: "2026-09-28", actualAdmissionDate: "2026-10-15" }),
    referral(2, { date: "2026-10-01", actualAdmissionDate: undefined, stage: "Assessment" }),
    referral(3, { date: "2026-10-05", actualAdmissionDate: "2026-10-22" }),
  ];
  assert.deepEqual(reports.admissionFlowCohort(all, "2026-10").map((item) => item.id), [2, 3]);
  assert.equal(reports.admissionFlowCohort(all, "").length, 3);
});

function routeFor(user, referralRecord, patchCalls) {
  return loadEntry("app/api/referrals/[referralId]/admission-flow/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => ({ ok: true, user }) },
    "@/lib/auth/assessor-session-policy": { pipelineAccountableActor: () => ({ id: user.id, name: user.name }) },
    "@/lib/auth/request-security": { requireSameOriginMutation: () => null },
    "@/lib/extraction/contracts": { jsonError: (message, status = 400) => Response.json({ error: message }, { status }),
      readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, work) => work() },
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async () => ({ ok: true, referral: referralRecord }),
      canConfirmAdmission: () => user.roles.includes("assessment_coordinator") },
    "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }),
      getReferralMutationReplay: async () => null,
      patchReferral: async (_id, patch) => { patchCalls.push(patch); return { ok: true, referral: { ...referralRecord, ...patch } }; } },
    "@/lib/pipeline/workflow-store": { getReferralWorkflowSnapshot: async () => ({ work_items: [] }) },
    "@/lib/pipeline/workflow-records": { getBlockingRequirementsForGates: () => [] },
  });
}

function request(body) {
  return new Request("http://localhost/api/referrals/42/admission-flow", { method: "PUT", body: JSON.stringify({ if_match: 1, if_match_section: 1, client_mutation_id: "fixture-1", ...body }) });
}

test("assessors cannot add admission timing work; coordinator records ready date and a hold", async () => {
  const referralRecord = referral(42, { date: "2026-10-01", stage: "Decision", actualAdmissionDate: undefined, admissionFlow: { holds: [] } });
  const patchCalls = [];
  const context = { params: Promise.resolve({ referralId: "42" }) };
  const assessor = routeFor({ id: "assessor", name: "Assessor", roles: ["reviewer"] }, referralRecord, patchCalls);
  assert.equal((await assessor.PUT(request({ action: "start_hold", reason: "source_records", responsible_party: "referral_source" }), context)).status, 403);
  assert.equal(patchCalls.length, 0);
  const coordinator = routeFor({ id: "coordinator", name: "Coordinator", roles: ["assessment_coordinator"] }, referralRecord, patchCalls);
  assert.equal((await coordinator.PUT(request({ action: "record_ready", ready_date: "2026-10-11" }), context)).status, 200);
  assert.equal(patchCalls[0].admissionFlow.readyToMoveInDate, "2026-10-11");
  assert.equal(patchCalls[0].admissionFlow.readyDateHistory.length, 1);
  assert.equal((await coordinator.PUT(request({ action: "start_hold", reason: "staffed_bed", responsible_party: "community" }), context)).status, 200);
  assert.equal(patchCalls[1].admissionFlow.holds[0].reason, "staffed_bed");
  assert.equal((await coordinator.PUT(request({ action: "start_hold", reason: "other", responsible_party: "community" }), context)).status, 400);
});

test("coordinator facts persist with workflow versioning, audit, and mutation replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-admission-flow-"));
  try {
    const processForTest = Object.assign(Object.create(process), { env: {
      ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: "disconnected", PIPELINE_DATABASE_URL: "",
      PIPELINE_REFERRAL_STORE_MODE: "local_file", PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"),
      PIPELINE_DEMO_MODE: "false", PIPELINE_PERSONA_DEMO: "false", NEXT_PUBLIC_PIPELINE_PERSONA_DEMO: "false",
    } });
    const store = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-store.ts", { process: processForTest });
    const actor = { id: "coordinator-fixture", name: "Fixture Coordinator" };
    const created = await store.createReferral({
      name: "Admission Flow Fixture", date: "10/1/2026", stage: "New", community: "Turlock",
      county: "Stanislaus County", source: "Hospital", priority: "standard", tags: [],
      owner: actor.name, ownerId: actor.id, note: "", createdAt: "2026-10-01T00:00:00Z",
      dob: "1/1/1980", phone: "", email: "", payer: "",
    }, "admission-flow-create", actor);
    const referral = created.referral;
    const tracking = { readyToMoveInDate: "2026-10-11", readyDateHistory: [{ date: "2026-10-11", recordedAt: "2026-10-11T12:00:00Z", recordedBy: actor.id }], holds: [] };
    const options = { auditAction: "admission_ready_recorded", mutationId: "ready-fixture", mutationScope: "admission_flow" };
    const saved = await store.patchReferral(referral.id, { admissionFlow: tracking }, referral.version, actor,
      { workflow: referral.sectionVersions.workflow }, options);
    assert.equal(saved.ok, true);
    assert.deepEqual((await store.getReferral(referral.id)).admissionFlow, tracking);
    assert.equal((await store.getReferralMutationReplay(referral.id, "admission_flow", "ready-fixture")).version, saved.referral.version);
    const conflict = await store.patchReferral(referral.id, { admissionFlow: { holds: [] } }, referral.version, actor,
      { workflow: referral.sectionVersions.workflow }, { auditAction: "admission_ready_date_corrected" });
    assert.equal(conflict.ok, false);
    const events = await store.listLocalReferralAuditEvents(referral.id);
    assert.equal(events.filter((event) => event.action === "admission_ready_recorded").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
