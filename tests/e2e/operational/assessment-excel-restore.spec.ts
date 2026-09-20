import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";
import { actorApiContext, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, signOperationalAssessment } from "../support/operational-api";
import type { PipelineAssessmentRecord } from "../../../lib/assessment/assessment-records";
import { assessmentToolSections, pickAssessmentToolData } from "../../../lib/assessment/assessment-tool-schema";

test.describe("Excel restore through canonical PostgreSQL API", () => {
  test.skip(process.env.PIPELINE_EXCEL_POSTGRES !== "true", "Use the isolated assessment-excel-postgres harness.");
  let sql: ReturnType<typeof postgres>;
  let assessor: APIRequestContext;
  let coordinator: APIRequestContext;
  let assessment: PipelineAssessmentRecord;
  let url: string;
  const source = { export_id: randomUUID(), exported_at: "2026-09-19T18:00:00.000Z" };

  test.beforeAll(() => {
    const databaseUrl = new URL(process.env.PIPELINE_TEST_DATABASE_URL!);
    expect(databaseUrl.hostname).toBe("127.0.0.1");
    sql = postgres(databaseUrl.toString(), { ssl: false, max: 1, prepare: false, onnotice: () => undefined });
  });
  test.afterAll(async () => { await sql?.end({ timeout: 5 }); });
  test.beforeEach(async ({ baseURL }) => {
    const base = requireOperationalBaseURL(baseURL);
    assessor = await actorApiContext("assessorA", base);
    coordinator = await actorApiContext("assessmentCoordinator", base);
    expect((await assessor.get("/api/members")).status()).toBe(200);
    expect((await coordinator.get("/api/members")).status()).toBe(200);
    const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
    const created = await createOperationalAssessment(assessor, referral.id);
    url = `/api/assessments/${created.assessment_id}`;
    assessment = (await (await assessor.get(url)).json()).assessment;
  });
  test.afterEach(async () => { await assessor.dispose(); await coordinator.dispose(); });

  function restoreRequest(data: Record<string, unknown>) {
    return {
      section: "prior_history", if_match_section: assessment.section_versions.prior_history,
      client_mutation_id: randomUUID(), patch: { data, workbook_restore: source },
    };
  }

  async function snapshot() {
    const records: Record<string, unknown> = {};
    for (const table of ["assessments", "assessment_field_provenance", "audit_events", "idempotency_keys", "store_revisions", "people", "referrals", "referral_fields", "work_items", "client_update_outbox"]) {
      records[table] = Array.from(await sql.unsafe(`select to_jsonb(r) as record from pipeline.${table} r order by to_jsonb(r)::text`));
    }
    return records;
  }

  test("restores answers, workbook provenance and actor audit exactly once", async () => {
    const data = { prior_placements: "Synthetic Excel placement", prior_hospitalizations_count: 0 };
    const request = restoreRequest(data);
    const response = await assessor.patch(url, { data: request });
    expect(response.status(), await response.text()).toBe(200);
    const saved = (await response.json()).assessment;
    expect(saved).toMatchObject({ ...data, signed_at: null, version: assessment.version + 1 });
    expect(saved.section_versions.prior_history).toBe(assessment.section_versions.prior_history + 1);
    for (const field of Object.keys(data)) {
      expect(saved.field_provenance[field].at(-1)).toMatchObject({
        source_field_key: `workbook.${field}`, source_file: `Excel backup ${source.export_id}`,
        evidence_url: `workbook://${source.export_id}?exported=${encodeURIComponent(source.exported_at)}`,
        review_status: "edited", confidence: 1,
      });
    }
    const audits = await sql`select * from pipeline.audit_events where entity_id = ${assessment.assessment_id} and action = 'assessment_imported'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: pipelineActors.assessorA.id, actor_name: pipelineActors.assessorA.name, from_version: assessment.version, to_version: saved.version });
    expect(audits[0].changed_fields.sort()).toEqual(Object.keys(data).sort());
    const beforeReplay = await snapshot();
    const replay = await assessor.patch(url, { data: request });
    expect(replay.status(), await replay.text()).toBe(200);
    expect((await replay.json()).assessment.version).toBe(saved.version);
    expect(await snapshot()).toEqual(beforeReplay);
  });

  test("pending workbook sources round-trip through private PostgreSQL recovery without changing the assessment", async () => {
    const draftUrl = `/api/me/assessment-drafts/${assessment.assessment_id}`;
    const baseData = pickAssessmentToolData(assessment);
    const workbookSources = { prior_placements: source };
    const draft = {
      schema: 1, assessmentId: assessment.assessment_id, savedAt: source.exported_at,
      baseVersion: assessment.version, sectionVersions: assessment.section_versions,
      dirtySections: assessmentToolSections, activeSection: "prior_history", baseData,
      data: { ...baseData, prior_placements: "Synthetic recovered workbook answer" }, workbookSources,
    };
    const before = await snapshot();
    const stored = await assessor.put(draftUrl, { data: { if_match: 0, draft } });
    expect(stored.status(), await stored.text()).toBe(200);
    const current = await (await assessor.get(draftUrl)).json();
    expect(current).toMatchObject({ version: 1, draft: { ...draft, savedAt: expect.any(String) } });
    const rows = await sql`select payload, version from pipeline.user_workspace_state where principal_id = ${pipelineActors.assessorA.id} and state_kind = 'assessment_draft' and state_key = ${assessment.assessment_id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.workbookSources).toEqual(workbookSources);
    expect((await (await coordinator.get(draftUrl)).json()).draft).toBeNull();
    const invalid = await assessor.put(draftUrl, { data: { if_match: 1, draft: { ...draft, workbookSources: { prior_placements: { ...source, extra: "rejected" } } } } });
    expect(invalid.status()).toBe(400);
    const stale = await assessor.put(draftUrl, { data: { if_match: 0, draft: { ...draft, workbookSources: {} } } });
    expect(stale.status()).toBe(409);
    expect(await (await assessor.get(draftUrl)).json()).toEqual(current);
    expect(await snapshot()).toEqual(before);
  });

  test("stale section/global CAS and malformed restore leave every protected table unchanged", async () => {
    const request = restoreRequest({ prior_placements: "Synthetic current answer" });
    expect((await assessor.patch(url, { data: request })).status()).toBe(200);
    const before = await snapshot();
    const sectionStale = await assessor.patch(url, { data: { ...request, client_mutation_id: randomUUID(), patch: { ...request.patch, data: { prior_placements: "Must not persist" } } } });
    expect(sectionStale.status()).toBe(409);
    const globalStale = await assessor.patch(url, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), patch: request.patch } });
    expect(globalStale.status()).toBe(409);
    const malformed = await assessor.patch(url, { data: { if_match: assessment.version + 1, patch: { ...request.patch, status: "complete" } } });
    expect(malformed.status()).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  test("signed restore is rejected without changing answers, signature, provenance or audit", async () => {
    const completed = await completeOperationalAssessment(assessor, assessment);
    const signed = await signOperationalAssessment(assessor, completed);
    const before = await snapshot();
    const denied = await assessor.patch(url, { data: { if_match: signed.version, client_mutation_id: randomUUID(), patch: { data: { prior_placements: "Must not change signed answer" }, workbook_restore: source } } });
    expect(denied.status(), await denied.text()).toBe(400);
    expect(await denied.text()).toContain("signed assessment");
    expect(await snapshot()).toEqual(before);
  });

  test("late audit failure rolls back answers, provenance, versions and retry identity", async () => {
    const request = restoreRequest({ prior_placements: "Synthetic retry after rollback", prior_hospitalizations_count: 2 });
    await sql.unsafe(`create function pipeline.reject_excel_audit() returns trigger language plpgsql as $$ begin
      if NEW.action = 'assessment_imported' then raise exception 'synthetic workbook audit failure'; end if; return NEW; end $$;
      create trigger reject_excel_audit before insert on pipeline.audit_events for each row execute function pipeline.reject_excel_audit();`);
    try {
      const before = await snapshot();
      const failed = await assessor.patch(url, { data: request });
      expect(failed.status()).toBe(400);
      expect(await snapshot()).toEqual(before);
    } finally {
      await sql`drop trigger reject_excel_audit on pipeline.audit_events`;
      await sql`drop function pipeline.reject_excel_audit()`;
    }
    const retry = await assessor.patch(url, { data: request });
    expect(retry.status(), await retry.text()).toBe(200);
    expect((await retry.json()).assessment).toMatchObject({ ...request.patch.data, version: assessment.version + 1 });
    expect(await sql`select 1 from pipeline.idempotency_keys where mutation_id = ${request.client_mutation_id}`).toHaveLength(1);
    expect(await sql`select 1 from pipeline.audit_events where entity_id = ${assessment.assessment_id} and action = 'assessment_imported'`).toHaveLength(1);
  });
});
