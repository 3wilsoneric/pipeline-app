import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import postgres from "postgres";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";

const { buildAssessorScorecard, scorecardRange } = loadEntry("lib/pipeline/assessor-scorecard-model.ts");
const { admissionFlowCohort } = loadEntry("lib/pipeline/admission-flow-cohort.ts");
const { parseUsageBatch } = loadEntry("lib/observability/assessor-usage-contract.ts");
const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", name: "Eric", roles: ["admin"] };
const members = [
  { id: "a", name: "Assessor A", active: true, roles: ["reviewer"], mergedInto: null },
  { id: "b", name: "Assessor B", active: true, roles: ["reviewer"], mergedInto: null },
  { id: "old-a", name: "Earlier A", active: false, roles: ["reviewer"], mergedInto: "a" },
];
const base = { period: "30d", since: "2026-11-01T07:00:00.000Z", through: "2026-11-13T20:00:00.000Z", usageSince: null, members, events: [], usage: [], work: [], memo: { clients: [] }, memoOwners: {} };
let sequence = 0;
const event = (action, patch = {}) => ({ id: `event-${++sequence}`, actorId: "a", actorName: "Assessor A", action, entityType: "assessment", entityId: "assessment-1", rootId: "root-1", fields: [], at: "2026-11-10T19:00:00.000Z", deliveryId: null, referralId: 1, client: "Synthetic Client", community: "San Pablo", ...patch });

test("Pacific reporting periods include DST midnight and stable launch cohort, not received-date imports", () => {
  assert.equal(scorecardRange("30d", new Date("2026-11-30T18:00:00Z")).since, "2026-11-01T07:00:00.000Z");
  assert.equal(scorecardRange("week", new Date("2026-11-01T18:00:00Z")).since, "2026-10-26T07:00:00.000Z");
  assert.equal(scorecardRange("week", new Date("2026-11-09T18:00:00Z")).since, "2026-11-09T08:00:00.000Z");
  assert.equal(scorecardRange("launch", new Date("2026-11-13T18:00:00Z")).since, "2026-09-18T07:00:00.000Z");
  const referral = { workspaceOrigin: "pipeline", workspaceStatus: "active", createdAt: "2026-09-18T07:00:00Z", date: "2020-01-01" };
  assert.equal(admissionFlowCohort([referral], "").length, 1);
  for (const patch of [{ workspaceStatus: "historical" }, { workspaceOrigin: "legacy" }, { deletedAt: "2026-10-01" }, { createdAt: "2026-09-18T06:59:59Z" }]) assert.equal(admissionFlowCohort([{ ...referral, ...patch }], "").length, 0);
});

test("actual actors, merged identities, distinct field work, empty saves and first completion attribution", () => {
  const result = buildAssessorScorecard({ ...base, events: [
    event("assessment_started", { at: "2026-11-10T17:00:00.000Z" }),
    event("assessment_updated", { fields: ["resident_name", "not_a_question"], actorId: "old-a" }),
    ...Array.from({ length: 30 }, () => event("assessment_updated", { fields: ["resident_name"] })),
    event("assessment_updated", { actorId: "b", fields: [] }),
    event("assessment_interview_completed"),
    event("assessment_interview_completed", { actorId: "b", at: "2026-11-11T17:00:00.000Z" }),
    event("assessment_signed", { actorId: "b" }),
    event("assessment_signed", { actorId: "a", at: "2026-11-11T20:00:00.000Z", entityId: "revision-2" }),
    event("assessment_updated", { actorId: "b", fields: ["date_of_birth"], actorName: "Assessor B (God mode by Eric)" }),
    event("assessment_updated", { actorId: "unlinked", fields: ["date_of_birth"] }),
  ] });
  const a = result.people.find(p => p.id === "a"), b = result.people.find(p => p.id === "b");
  assert.equal(a.evidence.fields.length, 1);
  assert.equal(a.evidence.clients.length, 1);
  assert.equal(a.evidence.interviews.length, 1);
  assert.equal(a.evidence.confirmed.length, 0);
  assert.equal(a.interviewSpanHours, 2);
  assert.equal(b.evidence.interviews.length, 0);
  assert.equal(b.evidence.confirmed.length, 1);
  assert.equal(b.evidence.fields.length, 0);
  assert.equal(result.unattributedEvents, 1);
  assert.equal(result.people.length, 2);
  assert.equal(a.usage, null, "no historical zero that pretends tracking existed");
});

test("earlier completion, repeated delivery acknowledgments and later resends never inflate new output", () => {
  const result = buildAssessorScorecard({ ...base, events: [
    event("assessment_signed", { at: "2026-10-25T17:00:00.000Z" }),
    event("assessment_signed", { actorId: "b" }),
    event("meet_client_summary_sent", { deliveryId: "one", at: "2026-10-25T18:00:00.000Z" }),
    event("meet_client_summary_sent", { deliveryId: "one" }),
    event("meet_client_summary_sent", { deliveryId: "two" }),
    event("meet_client_summary_sent", { deliveryId: "two", at: "2026-11-11T19:00:00.000Z" }),
    event("meet_client_summary_failed", { deliveryId: "three" }),
    event("meet_client_summary_failed", { deliveryId: "three" }),
    event("meet_client_summary_sent", { deliveryId: "four", referralId: 2 }),
  ] });
  const a = result.people.find(p => p.id === "a");
  assert.equal(result.people.find(p => p.id === "b").evidence.confirmed.length, 0);
  assert.equal(a.evidence.handoffs.length, 1);
  assert.equal(a.evidence.resends.length, 1);
  assert.equal(a.evidence.sendIssues.length, 1);
});

test("lifecycle projections never double credit; scheduling and post-send corrections remain contributions", () => {
  const result = buildAssessorScorecard({ ...base, events: [
    event("assessment_signed", { entityType: "referral", entityId: "1", rootId: null, fields: ["workflowStatus"] }),
    event("assessment_signed"),
    event("assessment_interview_completed"),
    event("assessment_interview_completed", { entityType: "referral", entityId: "1", rootId: null, fields: ["workflowStatus"] }),
    event("assessment_scheduled", { referralId: 2 }),
    event("extraction_confirmed", { fields: ["resident_name"] }),
    event("assessment_supplemented", { fields: ["resident_name", "date_of_birth"], referralId: 3 }),
  ] });
  const a = result.people.find(p => p.id === "a");
  assert.equal(a.evidence.interviews.length, 1);
  assert.equal(a.evidence.confirmed.length, 1);
  assert.equal(a.evidence.clients.length, 3);
  assert.equal(a.evidence.fields.length, 2);
});

test("current assignments and memo responsibility are distinct from historical contributions", () => {
  const work = { referral_id: 1, client_name: "Synthetic", community: "Turlock", board: { stage: "In progress" }, owner_id: "b", next_action: "Continue assessment", assignment_overdue: true, assignment_due_at: "2026-11-10T18:00:00Z" };
  const result = buildAssessorScorecard({ ...base, events: [event("document_uploaded", { entityId: "doc-1" })],
    work: [work, { ...work, referral_id: 2, owner_id: null }, { ...work, referral_id: 3, board: { stage: null } }],
    memo: { clients: [{ referral_id: 1, client_name: "Synthetic", community: "Turlock", tasks: [{ id: "dob", label: "Record date of birth" }] }] }, memoOwners: { 1: "a" },
  });
  assert.equal(result.people.find(p => p.id === "a").evidence.uploads.length, 1);
  assert.equal(result.people.find(p => p.id === "a").evidence.assigned.length, 0);
  assert.equal(result.people.find(p => p.id === "a").evidence.gaps.length, 1);
  assert.equal(result.people.find(p => p.id === "b").evidence.assigned.length, 1);
  assert.equal(result.people.find(p => p.id === "b").evidence.overdue.length, 1);
  assert.equal(result.unassignedWorkspaces, 1);
});

test("usage merges tab minutes and prior identities without inventing time before collection", () => {
  const result = buildAssessorScorecard({ ...base, usageSince: "2026-11-10T12:00:00Z", usage: [
    { actorId: "a", minute: "2026-11-10T18:00:00.000Z", interactions: 3 },
    { actorId: "old-a", minute: "2026-11-10T18:00:00.000Z", interactions: 4 },
    { actorId: "a", minute: "2026-11-10T18:01:00.000Z", interactions: 0 },
  ] });
  assert.deepEqual(clean(result.people.find(p => p.id === "a").usage), { interactions: 7, activeMinutes: 2, days: 1 });
});

test("usage batches reject arbitrary identity, timestamps, amounts, duplicate minutes and oversized batches", () => {
  const now = Date.now(), minute = new Date(Math.floor(now / 60000) * 60000).toISOString();
  const batch = { sessionId: crypto.randomUUID(), samples: [{ minute, interactions: 4 }], actorId: "spoof", typedText: "do not store" };
  const parsed = parseUsageBatch(batch, now);
  assert.deepEqual(Object.keys(parsed).sort(), ["samples", "sessionId"]);
  for (const samples of [[{ minute, interactions: -1 }], [{ minute, interactions: 1.5 }], [{ minute, interactions: 601 }], [{ minute: new Date(now + 3600000).toISOString(), interactions: 1 }], [batch.samples[0], batch.samples[0]], Array(6).fill(batch.samples[0])]) assert.equal(parseUsageBatch({ ...batch, samples }, now), null);
});

const logging = { withApiLogging: async (_request, _route, run) => run() };
test("scorecard access is private, rejects delegation and invalid periods, and never fabricates local metrics", async () => {
  const access = loadEntry("lib/pipeline/application-activity-access.ts");
  let reads = 0;
  function route(user, ready = true) {
    return loadEntry("app/api/operations/assessor-scorecard/route.ts", {
      "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => user ? { ok: true, user } : { ok: false, response: new Response(null, { status: 401 }) } },
      "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ ready }) },
      "@/lib/observability/api-logging": logging,
      "@/lib/pipeline/application-activity-access": access,
      "@/lib/pipeline/assessor-scorecard": { getAssessorScorecard: async () => { reads++; return {}; } },
    });
  }
  const request = new Request("https://pipeline.invalid/api/operations/assessor-scorecard");
  for (const user of [null, { ...owner, roles: ["reviewer"] }, { ...owner, id: "b", email: "b@example.invalid" }, { ...owner, delegation: {} }, { ...owner, demoPersona: "supervisor" }]) assert.equal((await route(user).GET(request)).status, user ? 403 : 401);
  assert.equal((await route(owner).GET(new Request(`${request.url}?period=bad`))).status, 400);
  assert.equal((await route(owner, false).GET(request)).status, 503);
  assert.equal(reads, 0);
  assert.equal((await route(owner).GET(request)).status, 200);
  assert.equal(reads, 1);
});

test("usage authenticates account and origin, suppresses mock/delegation and saves no payload identity", async () => {
  const now = Date.now();
  const batch = { sessionId: crypto.randomUUID(), samples: [{ minute: new Date(Math.floor(now / 60000) * 60000).toISOString(), interactions: 5 }], actorId: "b", text: "secret" };
  const writes = [];
  const request = (account = owner.id, origin = "https://pipeline.invalid") => new Request("https://pipeline.invalid/api/me/usage", { method: "POST", headers: { origin, "Content-Type": "application/json", "x-pipeline-usage-account": account }, body: JSON.stringify(batch) });
  const security = loadEntry("lib/auth/request-security.ts");
  const route = (user, mode = "entra_jwt") => loadEntry("app/api/me/usage/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => user ? { ok: true, user } : { ok: false, response: new Response(null, { status: 401 }) }, getPipelineAuthMode: () => mode },
    "@/lib/auth/request-security": security,
    "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ ready: true }) },
    "@/lib/observability/api-logging": logging,
    "@/lib/observability/assessor-usage-contract": { parseUsageBatch },
    "@/lib/observability/assessor-usage-store": { saveAssessorUsage: async (...args) => writes.push(args) },
  });
  assert.equal((await route(null).POST(request())).status, 401);
  assert.equal((await route(owner).POST(request("b"))).status, 409);
  assert.equal((await route(owner).POST(request(owner.id, "https://evil.invalid"))).status, 403);
  await route(owner, "mock").POST(request());
  assert.equal((await route({ ...owner, delegation: {} }).POST(request())).status, 409);
  assert.equal(writes.length, 0);
  assert.equal((await route(owner).POST(request())).status, 204);
  assert.equal(writes[0][0], owner.id);
  assert.doesNotMatch(JSON.stringify(writes), /secret|actorId/);
});

test("PostgreSQL scorecard uses real audit joins; usage retries and reordered concurrent saves are idempotent", { skip: !process.env.PIPELINE_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  url.pathname = "/postgres";
  const admin = postgres(url.href, { max: 1, ssl: false, onnotice() {} });
  const name = `pipeline_scorecard_${process.pid}`;
  let sql;
  try {
    await admin.unsafe(`create database "${name}"`);
    url.pathname = `/${name}`;
    sql = postgres(url.href, { max: 4, ssl: false, onnotice() {} });
    const migrationConnection = await sql.reserve();
    try {
      for (const file of (await readdir("database/migrations")).filter(f => f.endsWith(".sql")).sort()) await migrationConnection.unsafe(await readFile(`database/migrations/${file}`, "utf8"));
    } finally { migrationConnection.release(); }
    await sql`insert into pipeline.workspace_members (principal_id, display_name, email, roles) values ('a', 'Synthetic Assessor', 'a@example.invalid', ${["reviewer"]})`;
    const [{ person_id }] = await sql`insert into pipeline.people (display_name) values ('Synthetic Client') returning person_id`;
    const [{ referral_id }] = await sql`insert into pipeline.referrals (person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name) values (${person_id}, 'Assessment', 'Turlock', 'a', 'Synthetic', 'a', 'Synthetic') returning referral_id`;
    await sql`insert into pipeline.assessments (assessment_id, referral_id, assessor_id, status, created_by, created_by_name, updated_by, updated_by_name, revision_root_id) values ('test-assessment', ${referral_id}, 'a', 'draft', 'a', 'Synthetic', 'a', 'Synthetic', 'test-assessment')`;
    for (const action of ["assessment_started", "assessment_interview_completed", "assessment_signed"]) {
      await sql`insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, changed_fields, after_values) values ('assessment', 'test-assessment', ${action}, 'a', 'Synthetic Assessor', ${["resident_name"]}, ${sql.json({ secret: "never expose answers" })})`;
      await sql`insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, changed_fields) values ('referral', ${String(referral_id)}, ${action}, 'a', 'Synthetic Assessor', ${["workflowStatus"]})`;
    }
    const database = { getPipelineSql: () => sql };
    const store = loadEntry("lib/observability/assessor-usage-store.ts", { "@/lib/database/pipeline-database": database });
    const sessionId = crypto.randomUUID(), minute = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    await Promise.all([10, 3, 10, 7].map(interactions => store.saveAssessorUsage("a", { sessionId, samples: [{ minute, interactions }] })));
    await store.saveAssessorUsage("a", { sessionId: crypto.randomUUID(), samples: [{ minute, interactions: 4 }] });
    const { getAssessorScorecard } = loadEntry("lib/pipeline/assessor-scorecard.ts", {
      "@/lib/database/pipeline-database": database,
      "./operations-snapshot": { getAssessorScorecardWork: async () => ({ work: [{ referral_id: Number(referral_id), board: { stage: null } }], memo: { clients: [] }, memoOwners: {} }) },
    });
    const before = await sql`select count(*)::integer as count from pipeline.audit_events`;
    const result = await getAssessorScorecard(owner, "30d");
    const person = result.people.find(p => p.id === "a");
    assert.equal(person.evidence.interviews.length, 1);
    assert.equal(person.evidence.confirmed.length, 1);
    assert.equal(person.evidence.clients[0].client, "Synthetic Client");
    assert.deepEqual(clean(person.usage), { interactions: 14, activeMinutes: 1, days: 1 });
    assert.doesNotMatch(JSON.stringify(result), /never expose|secret/);
    assert.deepEqual(await sql`select count(*)::integer as count from pipeline.audit_events`, before);
    await sql.unsafe(await readFile("database/rollbacks/0049_assessor_usage.sql", "utf8"));
    const replay = await sql.reserve();
    try { await replay.unsafe(await readFile("database/migrations/0049_assessor_usage.sql", "utf8")); } finally { replay.release(); }
    assert.equal((await sql`select sum(interactions)::integer as n from pipeline.assessor_usage_minutes`)[0].n, 14, "migration replay preserves collected usage");
  } finally {
    await sql?.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
