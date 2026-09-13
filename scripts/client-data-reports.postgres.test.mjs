import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import * as identity from "../lib/pipeline/client-identity-presentation.mjs";
import * as months from "../lib/pipeline/workspace-month.mjs";

test("client reports query the migrated PostgreSQL owners without changing data", { skip: process.env.PIPELINE_REPORT_TEST_EPHEMERAL !== "true" }, async () => {
  const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/pipeline_reports_fixture");
  assert.notEqual(url.href, process.env.PIPELINE_DATABASE_URL);
  const sql = postgres(url.href, { ssl: false, max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql`
      insert into pipeline.people (external_client_id, display_name, date_of_birth)
      values ('report-fixture-a', 'Sample Report Client', '1980-04-12'), ('report-fixture-b', 'Sample Potential Client', null)
    `;
    const people = await sql`select person_id, external_client_id from pipeline.people order by external_client_id`;
    const actor = "report-fixture";
    const refs = [];
    for (const [index, person] of [people[0], people[0], people[1]].entries()) {
      const admitted = index === 0;
      const rows = await sql`
        insert into pipeline.referrals (person_id, stage, community, source, received_date, workspace_status, workflow_status, data, created_by, created_by_name, updated_by, updated_by_name)
        values (${person.person_id}, ${admitted ? "Accepted / Admitted" : "New"}, 'San Pablo', ${index === 2 ? "ALLO workspace" : "Sample Hospital"}, '2026-09-01', ${admitted ? "historical" : "active"}, ${admitted ? "admitted" : "intake_documents_needed"},
          ${sql.json({ name: index === 2 ? "Sample Potential Client" : "Sample Report Client", dob: index === 2 ? "" : "1980-04-12", date: "2026-09-01", admissionDate: admitted ? "2026-09-02" : "", historicalOutcome: admitted ? "admitted" : undefined })}, ${actor}, ${actor}, ${actor}, ${actor})
        returning referral_id
      `;
      refs.push(Number(rows[0].referral_id));
    }
    await sql`
      insert into pipeline.referral_fields (referral_id, field_key, final_value, review_status)
      values (${refs[0]}, 'referral.primary_diagnosis', '"Sample diagnosis"'::jsonb, 'confirmed'),
        (${refs[0]}, 'referral.allergies', '"NKDA"'::jsonb, 'edited'),
        (${refs[0]}, 'referral.current_medications', '"Documented medications"'::jsonb, 'confirmed'),
        (${refs[2]}, 'assessment_tool.ambulatory', '"yes"'::jsonb, 'pending')
    `;
    const contact = await sql`insert into pipeline.contacts (organization, search_text, created_by, created_by_name, updated_by, updated_by_name) values ('Sample Linked Hospital', 'sample linked hospital', ${actor}, ${actor}, ${actor}, ${actor}) returning contact_id`;
    await sql`insert into pipeline.referral_contacts (referral_id, contact_id, role, created_by, created_by_name, updated_by, updated_by_name) values (${refs[0]}, ${contact[0].contact_id}, 'referral_source', ${actor}, ${actor}, ${actor}, ${actor})`;
    await sql`
      insert into pipeline.assessments (assessment_id, revision_root_id, referral_id, status, signed_at, data, created_by, created_by_name, updated_by, updated_by_name)
      values ('report-fixture-signed', 'report-fixture-signed', ${refs[0]}, 'complete', now(), '{"ambulatory":"no"}', ${actor}, ${actor}, ${actor}, ${actor}),
        ('report-fixture-draft', 'report-fixture-draft', ${refs[2]}, 'draft', null, '{"ambulatory":"yes"}', ${actor}, ${actor}, ${actor}, ${actor})
    `;
    await sql`insert into pipeline.work_items (referral_id, person_id, type, label, gate, status, next_action) values (${refs[0]}, ${people[0].person_id}, 'face_sheet', 'Face sheet', 'admission_decision', 'needed', 'Upload face sheet')`;
    await seedReportDocuments(sql, people[0].person_id, refs[0], actor);

    const before = await sql`select md5(string_agg(row::text, ',' order by row::text)) as hash from (select to_jsonb(r) row from pipeline.referrals r union all select to_jsonb(d) from pipeline.documents d union all select to_jsonb(f) from pipeline.referral_fields f union all select to_jsonb(a) from pipeline.assessments a union all select to_jsonb(w) from pipeline.work_items w union all select to_jsonb(e) from pipeline.audit_events e) records`;
    await sql.begin("read only", async (tx) => {
      assert.equal((await tx`show transaction_read_only`)[0].transaction_read_only, "on");
      const database = { getPipelineSql: () => tx, getPipelineDatabaseReadiness: () => ({ mode: "postgres", ready: true }) };
      const env = { process: { ...process, env: { ...process.env, PIPELINE_REFERRAL_STORE_MODE: "postgres" } } };
      const referrals = loadEntry("lib/pipeline/referral-store.ts", { "@/lib/database/pipeline-database": database, "@/lib/pipeline/client-identity-presentation.mjs": identity, "@/lib/pipeline/workspace-month.mjs": months }, env);
      const workflow = loadEntry("lib/pipeline/workflow-store.ts", { "@/lib/database/pipeline-database": database, "@/lib/pipeline/referral-store": referrals, "@/lib/assessment/assessment-store": {} });
      const clients = loadEntry("lib/pipeline/client-workspace-store.ts", { "@/lib/database/pipeline-database": database, "@/lib/pipeline/referral-store": referrals, "@/lib/pipeline/resident-link-store": {}, "@/lib/pipeline/client-identity-presentation.mjs": identity });
      const reports = loadEntry("lib/pipeline/operations-reporting.ts", {
        "@/lib/database/pipeline-database": database, "@/lib/pipeline/referral-store": referrals,
        "@/lib/pipeline/workflow-store": workflow, "./client-workspace-store": clients,
        "./client-data-reports": loadTypeScriptModule(root, "lib/pipeline/client-data-reports.ts"),
        "./contact-store": {}, "@/lib/assessment/assessment-store": {}, "@/lib/pipeline/calendar-store": {}, "@/lib/pipeline/operations-snapshot": {},
        "@/lib/clinical/clinical-data": { ClinicalDataError: class extends Error {}, getClinicalRoster: async () => ({ residents: [], next_cursor: null, snapshot_id: "fixture", data_as_of: "2026-09-01", freshness: {} }) },
      });
      const user = { id: actor, name: actor, roles: ["admin"], accessScope: "pipeline" };
      const filters = { month: "", community: "", county: "", owner: "", client_scope: "all", care_topic: "ambulatory" };
      const run = (id) => reports.getOperationsReport(user, { ...filters, report_id: id });
      const community = await run("clients_by_community");
      assert.equal(community.report.rows.length, 2);
      assert.equal(community.report.summary.rows[0].values.clients, 2);
      const sources = await run("referral_sources");
      assert.equal(sources.report.rows.length, 2);
      assert.ok(sources.report.rows.some((row) => row.values.referral_source === "Sample Linked Hospital"));
      const care = await run("client_care_needs");
      assert.equal(care.report.rows.length, 1);
      assert.equal(care.report.rows[0].values.answer, "No");
      const chart = await run("chart_completeness");
      const complete = chart.report.rows.find((row) => row.values.client_key === "pipeline:report-fixture-a");
      assert.equal(complete.values.documents, 2);
      assert.equal(complete.values.chart_fields, "6 / 6");
      assert.equal(complete.values.assessment, "Signed");
      assert.equal(complete.values.missing_documents, "Face sheet");
      assert.ok(reports.operationsReportCsv(chart).startsWith('"Client","Community","Core chart fields","Files"'));
      await assert.rejects(reports.getOperationsReport({ ...user, roles: ["reviewer", "viewer"] }, { ...filters, report_id: "chart_completeness" }), { name: "ReportAccessError" });
      await assert.rejects(reports.recordOperationsReportExport({ ...user, roles: ["viewer"] }, chart), { name: "ReportAccessError" });
    });
    const after = await sql`select md5(string_agg(row::text, ',' order by row::text)) as hash from (select to_jsonb(r) row from pipeline.referrals r union all select to_jsonb(d) from pipeline.documents d union all select to_jsonb(f) from pipeline.referral_fields f union all select to_jsonb(a) from pipeline.assessments a union all select to_jsonb(w) from pipeline.work_items w union all select to_jsonb(e) from pipeline.audit_events e) records`;
    assert.equal(after[0].hash, before[0].hash);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

async function seedReportDocuments(sql, personId, referralId, actor) {
  for (const [index, status] of ["linked", "linked", "unmatched", "linked"].entries()) {
    await sql`
      insert into pipeline.documents (referral_id, person_id, category, file_name, content_type, byte_size, sha256, blob_container, blob_key, processing_status, uploaded_by, identity_status, deleted_at)
      values (${index === 1 ? null : referralId}, ${personId}, 'other', 'sample.pdf', 'application/pdf', 100, ${String(index).repeat(64)}, 'fixture', ${`report/${index}`}, 'uploaded', ${actor}, ${status}, ${index === 3 ? new Date() : null})
    `;
  }
}
