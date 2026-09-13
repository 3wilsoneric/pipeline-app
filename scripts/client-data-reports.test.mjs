import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import { loadEntry } from "./contact-import-fixtures.mjs";

const reports = loadTypeScriptModule(process.cwd(), "lib/pipeline/client-data-reports.ts");
const access = loadTypeScriptModule(process.cwd(), "lib/pipeline/report-access.ts");

function referral(id, changes = {}) {
  return { id, clientId: `client-${id}`, name: `Case ${id}`, community: "San Pablo", county: "Contra Costa County", source: "Sample Referral Hospital", stage: "New", date: "2026-09-01", createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-02T12:00:00Z", dob: "1980-04-12", owner: "", documentStatus: "Missing", requirements: [], ...changes };
}

function evidence(changes = {}) {
  return { fields: {}, documentCount: 0, requirements: [], ...changes };
}

function build(id, referrals, items = new Map(), filters = {}, residents = []) {
  return reports.buildClientDataReport({ id, label: id, filters: [], cadence: "Current", audience: "Supervisors", description: "" }, { report_id: id, month: "", community: "", county: "", owner: "", client_scope: "all", care_topic: "primary_diagnosis", ...filters }, referrals, items, residents);
}

test("all client reports remain supervisor/admin only", () => {
  for (const roles of [[], ["reviewer"], ["viewer"], ["reviewer", "viewer"]]) assert.equal(access.canAccessOperationsReports(roles), false);
  for (const role of ["admin", "assessment_coordinator"]) assert.equal(access.canAccessOperationsReports([role]), true);
});

test("report text removes reconstituted markup but preserves clinical comparisons", () => {
  assert.equal(reports.reportValue("**<b>Sample Facility</b>**"), "Sample Facility");
  assert.equal(reports.reportValue("<scrip<script>t>Sample</scr</script>ipt>"), "Sample");
  assert.equal(reports.reportValue("<__script>Sample</script>"), "Sample");
  assert.equal(reports.reportValue("CD4<200; dose > 10 mg; age < 65"), "CD4<200; dose > 10 mg; age < 65");
  assert.equal(reports.reportValue("<b>Not recorded</b>"), "");
  assert.equal(reports.reportValue("<b>No</b>"), "No");
});

test("both report routes require supervisor/admin before reading data or exporting", async () => {
  let authenticationCalls = 0;
  const route = loadEntry("app/api/operations/reports/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: (_request, roles) => {
      authenticationCalls++;
      assert.deepEqual(Array.from(roles), ["admin", "assessment_coordinator"]);
      return { ok: false, response: Response.json({ error: "Insufficient role" }, { status: 403 }) };
    } },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _path, work) => work() },
    "@/lib/pipeline/referral-store": { requireReferralStore: () => assert.fail("Unauthorized report read") },
    "@/lib/pipeline/operations-reporting": { getOperationsReport: () => assert.fail("Unauthorized report"), recordOperationsReportExport: () => assert.fail("Unauthorized export") },
    "@/lib/assessment/assessment-store": {},
  });
  assert.equal((await route.GET(new Request("http://localhost/api/operations/reports"))).status, 403);
  assert.equal((await route.POST(new Request("http://localhost/api/operations/reports", { method: "POST" }))).status, 403);
  assert.equal(authenticationCalls, 2);
});

test("community totals deduplicate stable client identities, never names", () => {
  const rows = [referral(1, { clientId: "same-person", name: "JANE DOE (HV) 09/01" }), referral(2, { clientId: "same-person", name: "Jane Doe" }), referral(3, { name: "Jane Doe" })];
  const result = build("clients_by_community", rows);
  assert.equal(result.rows.length, 2);
  assert.equal(result.summary.rows[0].values.clients, 2);
  assert.equal(result.rows.find((row) => row.values.client_key === "pipeline:same-person").values.referrals, 2);
  assert.equal(result.rows[0].client_name, "Jane Doe");
});

test("acceptance does not imply admission; historical confirmed admissions do", () => {
  const rows = [referral(1, { workflowStatus: "accepted", stage: "Accepted / Admitted", admissionDate: "2026-10-01" }), referral(2, { workflowStatus: "admitted", admissionDate: "2026-09-01" }), referral(3, { workspaceStatus: "historical", historicalOutcome: "admitted", stage: "Accepted / Admitted", admissionDate: "2024-05-02" })];
  const result = build("clients_by_community", rows, new Map(), { client_scope: "admitted" });
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.values.status === "Admitted"));
});

test("admission month uses real admission dates, never created/filing dates", () => {
  const rows = [referral(1, { workflowStatus: "admitted", admissionDate: "2024-02-29", workspaceMonth: "2026-09" }), referral(2, { workflowStatus: "admitted", admissionDate: "2026-02-29" }), referral(3, { workflowStatus: "admitted" })];
  const result = build("clients_by_community", rows, new Map(), { month: "2024-02" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.admission_date, "2024-02-29");
  assert.ok(result.notes.some((note) => note.includes("2 clients have no documented admission date")));
});

test("repeat admission dates display the event from the selected month", () => {
  const rows = [referral(1, { clientId: "same", workflowStatus: "admitted", admissionDate: "2024-02-01" }), referral(2, { clientId: "same", workflowStatus: "admitted", admissionDate: "2026-09-01", updatedAt: "2026-09-03T12:00:00Z" })];
  const result = build("clients_by_community", rows, new Map(), { month: "2024-02" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.admission_date, "2024-02-01");
});

test("admission month filters the community of that admission, not a later referral", () => {
  const rows = [referral(1, { clientId: "same", workflowStatus: "admitted", admissionDate: "2024-02-01", community: "San Pablo" }), referral(2, { clientId: "same", workflowStatus: "admitted", admissionDate: "2026-09-01", community: "Santa Clarita", updatedAt: "2026-09-03T12:00:00Z" })];
  assert.equal(build("clients_by_community", rows, new Map(), { month: "2024-02", community: "San Pablo" }).rows.length, 1);
  assert.equal(build("clients_by_community", rows, new Map(), { month: "2024-02", community: "Santa Clarita" }).rows.length, 0);
});

test("current-resident scope excludes unconfirmed lookalike referral identities", () => {
  const resident = { resident_key: "337:sample", display_name: "Sample Resident", community_name: "San Pablo", admit_date: "2024-01-01" };
  const result = build("clients_by_community", [referral(1, { name: "Sample Resident" })], new Map(), { client_scope: "current" }, [resident]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.profile_id, "resident:337:sample");
});

test("explicitly linked referral-source contact takes precedence over facility text", () => {
  const result = build("referral_sources", [referral(1)], new Map([[1, evidence({ fields: { "report.referral_source": "Sample Linked Facility", "referral.referring_facility": "Older Sample Facility" } })]]));
  assert.equal(result.rows[0].values.referral_source, "Sample Linked Facility");
});

test("missing community/counties never become visible categories", () => {
  const result = build("clients_by_community", [referral(1, { community: "Unassigned", county: "Not recorded" }), referral(2, { county: "" })]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.rows.length, 1);
  assert.equal(result.counties.length, 0);
  assert.ok(result.notes.some((note) => note.includes("1 of 2")));
});

test("referral sources exclude technical origin and carried chart labels", () => {
  const rows = [referral(1, { source: "ALLO workspace" }), referral(2, { source: "Email" }), referral(3, { chartSource: { referralId: 1 }, source: "Old Referring Hospital" }), referral(4)];
  const result = build("referral_sources", rows);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.referral_source, "Sample Referral Hospital");
});

test("reviewed facility wins, repeated referral sources count one client", () => {
  const rows = [referral(1, { clientId: "same" }), referral(2, { clientId: "same" })];
  const items = new Map(rows.map((row) => [row.id, evidence({ fields: { "referral.referring_facility": "Sample Reviewed Facility" } })]));
  const result = build("referral_sources", rows, items);
  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.rows[0].values.clients, 1);
  assert.equal(result.rows[0].values.referral_source, "Sample Reviewed Facility");
});

test("pending/rejected extraction values never enter reports", () => {
  const fields = reports.reviewedReportFields([
    { field_key: "assessment.ambulatory", final_value: "yes", review_status: "pending" },
    { field_key: "referral.primary_diagnosis", final_value: "Unreviewed diagnosis", review_status: "rejected" },
    { field_key: "special_diet", final_value: "no", review_status: "accepted" },
    { field_key: "medication_adherence", final_value: "no", review_status: "edited" },
  ]);
  assert.equal(fields["assessment.ambulatory"], undefined);
  assert.equal(fields["referral.primary_diagnosis"], undefined);
  assert.equal(fields.special_diet, "no");
  assert.equal(fields.medication_adherence, "no");
});

test("reviewed assessment-tool fields use the canonical extraction mapping", () => {
  const items = new Map([[1, evidence({ fields: { "assessment_tool.ambulatory": "no", "assessment_tool.referring_facility": "Sample Prior Facility", "assessment_tool.primary_diagnosis": "Sample diagnosis", "assessment_tool.medications_at_intake": ["Documented medication"], "referral.allergies": "NKDA" } })]]);
  assert.equal(build("client_care_needs", [referral(1)], items, { care_topic: "ambulatory" }).rows[0].values.answer, "No");
  assert.equal(build("referral_sources", [referral(1)], items).rows[0].values.referral_source, "Sample Referral Hospital");
  assert.equal(build("chart_completeness", [referral(1)], items).rows[0].values.chart_fields, "6 / 6");
});

test("care reports distinguish documented No from unknown and use assessment option labels", () => {
  const rows = [referral(1), referral(2), referral(3), referral(4)];
  const items = new Map([[1, evidence({ fields: { ambulatory: "no" } })], [2, evidence({ fields: { ambulatory: "yes" } })], [3, evidence({ fields: { ambulatory: "unable_to_assess" } })], [4, evidence({ fields: { ambulatory: null } })]]);
  const result = build("client_care_needs", rows, items, { care_topic: "ambulatory" });
  assert.equal(result.rows.length, 2);
  assert.equal(result.summary.rows.length, 2);
  assert.ok(result.summary.rows.every((row) => row.values.share === "50%"));
  assert.equal(result.rows[0].values.answer, "No");
});

test("signed answers win over extraction, drafts do not contribute", () => {
  const rows = [referral(1), referral(2)];
  const items = new Map([[1, evidence({ fields: { medication_adherence: "yes" }, assessment: { status: "complete", signed_at: "2026-09-01T12:00:00Z", medication_adherence: "no" } })], [2, evidence({ assessment: { status: "draft", medication_adherence: "yes" } })]]);
  const result = build("client_care_needs", rows, items, { care_topic: "medication_adherence" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.answer, "No");
});

test("county and admission filters scope both summary and client rows", () => {
  const result = build("clients_by_community", [referral(1, { workflowStatus: "admitted" }), referral(2, { county: "Los Angeles County", workflowStatus: "admitted" }), referral(3)], new Map(), { county: "Contra Costa County", client_scope: "admitted" });
  assert.equal(result.rows.length, 1);
  assert.equal(result.summary.rows[0].values.clients, 1);
});

test("only confirmed resident links deduplicate clinical and referral records", () => {
  const resident = { resident_key: "337:sample", canonical_client_id: "sample", display_name: "Sample Resident", community_name: "San Pablo", admit_date: "2024-01-01" };
  const rows = [referral(1, { name: "Sample Resident" })];
  assert.equal(build("clients_by_community", rows, new Map(), {}, [resident]).rows.length, 2);
  const linked = build("clients_by_community", rows, new Map([[1, evidence({ residentKey: resident.resident_key })]]), {}, [resident]);
  assert.equal(linked.rows.length, 1);
  assert.equal(linked.rows[0].values.profile_id, "resident:337:sample");
});

test("chart core fields match chart requirements; future/inapplicable documents are not gaps", () => {
  const requirements = [{ id: "future", type: "signed_admission_agreement", label: "Admission agreement", requiredFor: "move_in", status: "needed" }, { id: "waived", type: "tb_test", label: "TB test", requiredFor: "pre_assessment", status: "waived" }, { id: "needed", type: "face_sheet", label: "Face sheet", requiredFor: "pre_assessment", status: "needed" }];
  const result = build("chart_completeness", [referral(1)], new Map([[1, evidence({ documentCount: 3, requirements, fields: { "referral.primary_diagnosis": "Sample documented diagnosis", "referral.allergies": "NKDA", "referral.current_medications": "Documented medication list" } })]]));
  assert.equal(result.rows[0].values.chart_fields, "6 / 6");
  assert.equal(result.rows[0].values.missing_fields, "");
  assert.equal(result.rows[0].values.missing_documents, "Face sheet");
  assert.equal(result.rows[0].values.documents, 3);
});

test("unconfigured packet requirements are never presented as complete", () => {
  const result = build("chart_completeness", [referral(1)]);
  assert.equal(result.rows[0].values.packet_requirements, "Not configured");
  assert.equal(result.rows[0].values.assessment, "");
  assert.equal(result.rows[0].values.documents, 0);
});
