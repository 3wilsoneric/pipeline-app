import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { loadEntry } from "./contact-import-fixtures.mjs";

const records = [
  { assessment_id: "first", referral_id: 1, completed_at: null, signed_at: null, audit_events: [
    { action: "assessment_interview_completed", created_at: "2026-11-10T18:00:00Z" },
    { action: "assessment_started", created_at: "2026-11-01T18:00:00Z" },
  ] },
  { assessment_id: "revision", referral_id: 1, completed_at: "2026-11-16T18:00:00Z", signed_at: null, audit_events: [] },
  { assessment_id: "legacy", referral_id: 2, completed_at: "2026-11-12T18:00:00Z", signed_at: "2026-11-11T18:00:00Z", audit_events: [] },
  { assessment_id: "planned", referral_id: 3, completed_at: null, signed_at: null, audit_events: [
    { action: "assessment_scheduled", created_at: "2026-11-10T18:00:00Z" },
  ] },
  { assessment_id: "excluded", referral_id: 4, completed_at: "2026-11-12T18:00:00Z", signed_at: null, audit_events: [] },
];
const expected = [[1, "2026-11-10T18:00:00.000Z"], [2, "2026-11-11T18:00:00.000Z"]];
const load = store => loadEntry("lib/assessment/assessment-completion-milestones.ts", {
  "./assessment-store": store,
  "@/lib/database/pipeline-database": { getPipelineSql: () => store.sql },
});
const normalized = map => JSON.parse(JSON.stringify([...map].sort((a, b) => a[0] - b[0])));

test("first completion survives reopening and revisions; plans and unrelated clients do not count", async () => {
  const cursors = [];
  const owner = load({ getAssessmentStoreReadiness: () => ({ mode: "local_file" }), listAssessments: async ({ cursor }) => {
    cursors.push(cursor);
    return cursor ? { assessments: records.slice(2), next_cursor: null } : { assessments: records.slice(0, 2), next_cursor: "page2" };
  } });
  assert.deepEqual(normalized(await owner.getFirstAssessmentCompletions([1, 2, 3])), expected);
  assert.deepEqual(cursors, [undefined, "page2"]);
  assert.equal((await owner.getFirstAssessmentCompletions([])).size, 0);
  assert.equal(cursors.length, 2);
});

test("local evidence limit fails explicitly rather than publishing partial totals", async () => {
  const owner = load({ getAssessmentStoreReadiness: () => ({ mode: "local_file" }), listAssessments: async () => ({ assessments: Array(200).fill(records[2]), next_cursor: "more" }) });
  await assert.rejects(owner.getFirstAssessmentCompletions([1]), /reporting limit/);
});

test("PostgreSQL returns the same first milestone as local storage", { skip: !process.env.PIPELINE_MILESTONE_TEST_URL }, async () => {
  const url = new URL(process.env.PIPELINE_MILESTONE_TEST_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/monday_completion_test_/);
  const sql = postgres(url.href, { max: 1 });
  try {
    await sql`create schema pipeline`;
    await sql`create table pipeline.assessments (assessment_id text primary key, referral_id bigint, completed_at timestamptz, signed_at timestamptz)`;
    await sql`create table pipeline.audit_events (entity_type text, entity_id text, action text, created_at timestamptz)`;
    for (const { audit_events, ...record } of records) {
      await sql`insert into pipeline.assessments ${sql(record)}`;
      for (const event of audit_events) await sql`insert into pipeline.audit_events ${sql({ entity_type: "assessment", entity_id: record.assessment_id, ...event })}`;
    }
    const owner = load({ sql, getAssessmentStoreReadiness: () => ({ mode: "postgres" }) });
    assert.deepEqual(normalized(await owner.getFirstAssessmentCompletions([1, 2, 3])), expected);
  } finally { await sql.end(); }
});
