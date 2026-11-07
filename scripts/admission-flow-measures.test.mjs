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
    workspaceOrigin: "pipeline", workspaceStatus: "active", createdAt: "2026-09-20T12:00:00Z",
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
  assert.equal(byId.get(1).assessment_to_ready_days, 8);
  assert.equal(byId.get(1).waiting_phase, "");
  assert.equal(byId.get(2).waiting_phase, "No assessment date recorded");
  assert.equal(byId.get(1).rework, "1 / 2");
  assert.equal(byId.get(2).total_days, null);
  assert.notEqual(byId.get(2).state, "Admitted");
  assert.equal(byId.get(3).state, "Did not move in");
  assert.equal(byId.get(4).assessment_days, null);
  const metrics = reports.reportMetrics("admission_flow", rows);
  assert.equal(metrics.find((item) => item.label === "Actual admissions").value, "2");
  assert.equal(metrics.find((item) => item.label === "Median receipt to assessment").value, "2 days");
  assert.equal(metrics.find((item) => item.label === "Median assessment to arrival").value, "12 days");
  assert.equal(metrics.find((item) => item.label === "Assessment date coverage").value, "1 of 2");
  assert.equal(metrics.find((item) => item.label === "Did not move in").value, "1");
  assert.equal(metrics.find((item) => item.label === "Ready, awaiting arrival").value, "0");
  assert.equal(metrics.find((item) => item.label === "Arrival share").value, "50%");
});

test("executive weekly cohorts retain open referrals and show only confirmed arrivals", () => {
  const rows = reports.admissionFlowRows([
    referral(1, { date: "2026-10-05", actualAdmissionDate: "2026-10-12" }),
    referral(2, { date: "2026-10-06", actualAdmissionDate: undefined, stage: "Assessment", admissionDecision: undefined }),
    referral(3, { date: "2026-10-13", actualAdmissionDate: undefined, stage: "Closed", placementCancellation: { cancelledAt: "2026-10-18T00:00:00Z" } }),
  ], new Map(), new Map());
  const summary = reports.admissionFlowWeekSummary(rows);
  assert.equal(summary.rows.length, 2);
  const firstWeek = summary.rows.find((row) => row.values.group === "2026-10-05");
  assert.deepEqual([firstWeek.values.received, firstWeek.values.admitted, firstWeek.values.open, firstWeek.values.arrival_share], [2, 1, 1, "50%"]);
  assert.equal(summary.rows.find((row) => row.values.group === "2026-10-12").values.closed_without_arrival, 1);
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

test("launch cutoff includes every genuine workspace outcome and preserves earlier receipt dates", () => {
  const records = [
    referral(1, { workspaceOrigin: "import" }),
    referral(2, { workspaceOrigin: "allo" }),
    referral(3, { workspaceStatus: "historical" }),
    referral(4, { workspaceOrigin: undefined }),
    referral(5, { deletedAt: "2026-10-20T00:00:00Z" }),
    referral(6, { createdAt: "2026-09-17T12:00:00Z" }),
    referral(7, { createdAt: "invalid" }),
    referral(8, { actualAdmissionDate: undefined, stage: "Assessment" }),
    referral(9, { actualAdmissionDate: undefined, stage: "Declined", admissionDecision: { outcome: "declined" } }),
    referral(10, { workspaceStatus: "archived", tags: ["Discharged"] }),
    referral(11, { chartSource: { referralId: 3 }, tags: ["packet-import"] }), // A real new referral from an older chart.
    referral(12, { date: "2027-01-03", createdAt: "2027-01-03T12:00:00Z", actualAdmissionDate: "2027-01-05" }),
    referral(13, { date: "2026-09-15", createdAt: "2026-09-18T07:00:00Z" }), // First instant of the cutoff day in Pacific time.
    referral(14, { date: "", actualAdmissionDate: undefined }),
    referral(15, { createdAt: "2026-09-18T06:59:59Z" }), // Still September 17 in Pacific time.
    referral(16, { createdAt: "2026-10-16T12:00:00Z" }), // Inclusion must not depend on arrival vs data-entry order.
    referral(17, { actualAdmissionDate: undefined, stage: "Closed", placementCancellation: { cancelledAt: "2026-10-20T12:00:00Z" } }),
  ];
  assert.deepEqual(Array.from(reports.admissionFlowCohort(records, ""), (item) => item.id), [8, 9, 10, 11, 12, 13, 14, 16, 17]);
  assert.deepEqual(Array.from(reports.admissionFlowCohort(records, "2026-10"), (item) => item.id), [8, 9, 10, 11, 16, 17]);
  assert.deepEqual(Array.from(reports.admissionFlowCohort(records, "2027-01"), (item) => item.id), [12]);
  assert.equal(reports.admissionFlowCohort(records, "2026-09")[0].date, "2026-09-15");
});

test("report totals, received weeks, and CSV share the native cohort even behind more than 5,000 imported charts", async () => {
  const records = [
    ...Array.from({ length: 5200 }, (_, index) => referral(index + 100, { name: "Imported resident", workspaceOrigin: "import" })),
    referral(1, { name: "Historical chart", workspaceStatus: "historical" }),
    referral(2, { name: "Pre-launch workspace", createdAt: "2026-09-17T12:00:00Z" }),
    referral(3, { name: "Native admission", owner: "Assessor", date: "2026-10-05", actualAdmissionDate: "2026-10-12" }),
    referral(4, { name: "Open referral", actualAdmissionDate: undefined, stage: "Assessment", admissionDecision: undefined, date: "2026-10-06" }),
    referral(5, { name: "Denied referral", actualAdmissionDate: undefined, stage: "Declined", admissionDecision: { outcome: "declined" }, date: "2026-10-07" }),
    referral(6, { name: "Later admission", date: "2026-11-01", actualAdmissionDate: "2026-11-02", chartSource: { referralId: 1 } }),
  ];
  const assessmentReads = [];
  const auditReads = [];
  const reporting = loadEntry("lib/pipeline/operations-reporting.ts", {
    "./client-workspace-store": {}, "./client-data-reports": {}, "./contact-store": {},
    "@/lib/pipeline/referral-store": {
      getReferralStoreReadiness: () => ({ mode: "local_file", ready: true }),
      listReferralFacets: async () => ({ communities: ["San Pablo"], owners: ["Assessor"] }),
      listReferrals: async ({ cursor, limit, workspaceStatus }) => {
        assert.equal(workspaceStatus, "all");
        const start = Number(cursor || 0);
        return { referrals: records.slice(start, start + limit), next_cursor: start + limit < records.length ? String(start + limit) : undefined };
      },
      listLocalReferralAuditEvents: async (id) => { auditReads.push(id); return []; },
    },
    "@/lib/assessment/assessment-store": {
      listAssessments: async ({ referralId }) => { assessmentReads.push(referralId); return { assessments: [{ assessment_date: "2026-10-07" }] }; },
    },
  });
  const user = { id: "executive", email: "ericwilsonalamo@outlook.com", roles: ["admin"], accessScope: "pipeline" };
  const filters = { report_id: "admission_flow", month: "", community: "", owner: "" };
  const view = await reporting.getOperationsReport(user, filters);
  const exported = await reporting.getOperationsReport(user, filters, { export: true });
  assert.equal(view.report.row_count, 4);
  assert.equal(view.report.truncated, false);
  for (const key of ["rows", "metrics", "summary", "columns", "row_count", "notes"]) assert.deepEqual(view.report[key], exported.report[key]);
  assert.equal(view.report.metrics.find((item) => item.label === "Actual admissions").value, "2");
  assert.equal(view.report.metrics.find((item) => item.label === "Arrival share").value, "50%");
  assert.equal(view.report.metrics.find((item) => item.label === "Open referrals").value, "1");
  assert.equal(view.report.metrics.find((item) => item.label === "Median receipt to arrival").value, "4 days");
  assert.equal(view.report.summary.rows.reduce((total, row) => total + row.values.received, 0), 4);
  assert.equal(view.report.summary.rows.reduce((total, row) => total + row.values.admitted, 0), 2);
  const csv = reporting.operationsReportCsv(exported);
  for (const name of ["Native admission", "Open referral", "Denied referral", "Later admission"]) assert.ok(csv.includes(name));
  assert.doesNotMatch(csv, /Imported resident|Historical chart|Pre-launch workspace/);
  assert.deepEqual([...new Set(assessmentReads)].sort(), [3, 4, 5, 6]);
  assert.deepEqual([...new Set(auditReads)].sort(), [3, 4, 5, 6]);
  const october = await reporting.getOperationsReport(user, { ...filters, month: "2026-10" });
  assert.equal(october.report.row_count, 3);
  assert.equal(october.report.metrics.find((item) => item.label === "Actual admissions").value, "1");
  assert.equal(october.report.summary.rows.length, 1);
  assert.doesNotMatch(reporting.operationsReportCsv(october), /Later admission|Imported resident|Historical chart/);
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
    "@/lib/pipeline/report-access": { canAccessExecutiveAdmissionFlow: () => user.email === "ericwilsonalamo@outlook.com" },
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
  assert.equal((await coordinator.PUT(request({ action: "record_ready", ready_date: "2026-10-11" }), context)).status, 403);
  const executive = routeFor({ id: "executive", email: "ericwilsonalamo@outlook.com", name: "Executive", roles: ["assessment_coordinator"] }, referralRecord, patchCalls);
  assert.equal((await executive.PUT(request({ action: "record_ready", ready_date: "2026-10-11" }), context)).status, 200);
  assert.equal(patchCalls[0].admissionFlow.readyToMoveInDate, "2026-10-11");
  assert.equal(patchCalls[0].admissionFlow.readyDateHistory.length, 1);
  assert.equal((await executive.PUT(request({ action: "start_hold", reason: "staffed_bed", responsible_party: "community" }), context)).status, 200);
  assert.equal(patchCalls[1].admissionFlow.holds[0].reason, "staffed_bed");
  assert.equal((await executive.PUT(request({ action: "start_hold", reason: "other", responsible_party: "community" }), context)).status, 400);
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
