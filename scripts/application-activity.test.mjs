import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { loadEntry } from "./contact-import-fixtures.mjs";

const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", name: "Eric", roles: ["admin"], accessScope: "pipeline" };
const policy = loadEntry("lib/pipeline/application-activity-access.ts");
const cursor = loadEntry("lib/pipeline/keyset-cursor.ts");
const logging = loadEntry("lib/observability/api-logging.ts", {
  "@/lib/observability/pipeline-metrics": { recordPipelineMetric() {} },
  "@/lib/reliability/request-governor": { acquireRequestCapacity: () => ({ ok: true, release() {} }) },
}, { console: { log() {}, error() {} } });

test("private dashboard denies other admins, role-only access, delegation, demos and anonymous requests", async () => {
  const people = [null, { ...owner, id: "andrew", email: "andrew@aaahealthservices.com" }, { ...owner, id: "vince", email: "vince@aaahealthservices.com" }, { ...owner, roles: ["viewer"] }, { ...owner, delegation: { initiatedBy: owner } }, { ...owner, demoPersona: "supervisor" }];
  for (const user of people) {
    let reads = 0;
    const route = activityRoute(user, async () => { reads++; return {}; });
    const response = await route.GET(request());
    assert.equal(response.status, user ? 403 : 401);
    assert.equal(reads, 0);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
  }
  assert.equal(policy.canAccessApplicationActivity({ ...owner, email: "guest#EXT#@tenant.onmicrosoft.com" }), true);
  assert.equal(policy.canAccessApplicationActivity({ ...owner, id: "email-linked", email: " ERICWILSONALAMO@OUTLOOK.COM " }), true);
});

test("activity endpoint bounds date windows and cursor IDs before querying storage", async () => {
  let reads = 0;
  const route = activityRoute(owner, async () => { reads++; return { events: [] }; });
  for (const params of ["since=no", "since=2020-01-01", `since=${new Date().toISOString()}&through=invalid`, `cursor=${cursor.encodeKeysetCursor({ timestamp: new Date().toISOString(), key: "not-a-uuid" })}`]) {
    assert.equal((await route.GET(request(params))).status, 400);
  }
  assert.equal(reads, 0);
  assert.equal((await route.GET(request())).status, 200);
  assert.equal(reads, 1);
  assert.equal((await activityRoute(owner, () => assert.fail("no fabricated local data"), false).GET(request())).status, 503);
});

test("only new successful sessions are recorded; reporting failure never rejects sign-in", async () => {
  let existing = false, failed = false, writes = 0, warnings = 0;
  const db = { getPipelineDatabaseReadiness: () => ({ ready: true }), getPipelineSql: () => async () => { writes++; if (failed) throw Error("secret db details"); } };
  const record = loadEntry("lib/auth/sign-in-activity.ts", {
    "@/lib/database/pipeline-database": db,
    "@/lib/auth/pipeline-auth": { canAccessPipeline: () => true, hasPipelineSessionForUser: async () => existing },
  }, { console: { warn(message) { warnings++; assert.doesNotMatch(message, /secret|Eric|outlook/); } } });
  await record.recordPipelineSignIn(request(), owner);
  existing = true;
  await record.recordPipelineSignIn(request(), owner);
  assert.equal(writes, 1, "refreshing the same session does not add a sign-in");
  existing = false; failed = true;
  await assert.doesNotReject(record.recordPipelineSignIn(request(), owner));
  assert.equal(warnings, 1);
  await record.recordPipelineSignIn(request(), { ...owner, delegation: {} });
  assert.equal(writes, 2);

  const deferred = [];
  let auditCalls = 0;
  const route = loadEntry("app/api/auth/session/route.ts", {
    "next/server": { NextResponse: Response, after: (fn) => deferred.push(fn) },
    "@/lib/auth/assessor-session": { clearAssessorSessionCookie: () => "delegation=; Max-Age=0" },
    "@/lib/auth/pipeline-auth": { requireAuthenticatedUser: () => ({ ok: true, user: owner }), createPipelineSessionCookie: () => "session=fixture; HttpOnly", clearPipelineSessionCookie: () => "session=" },
    "@/lib/auth/request-security": { requireSameOriginMutation: () => null },
    "@/lib/auth/sign-in-activity": { recordPipelineSignIn: async () => { auditCalls++; } },
    "@/lib/observability/api-logging": logging,
  });
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(auditCalls, 0, "login returns without waiting for database reporting");
  await deferred[0]();
  assert.equal(auditCalls, 1);
});

test("session detection verifies the encrypted cookie and account rather than trusting its presence", async () => {
  const auth = loadEntry("lib/auth/pipeline-auth.ts", {}, {
    process: { ...process, env: { ...process.env, PIPELINE_ENTRA_SESSION_SECRET: "synthetic-test-secret-activity-cookie-2026" } },
  });
  const cookie = await auth.createPipelineSessionCookie(new Request("https://pipeline.invalid"), owner);
  const signed = new Request("https://pipeline.invalid", { headers: { cookie: cookie.split(";")[0] } });
  assert.equal(await auth.hasPipelineSessionForUser(signed, owner.id), true);
  assert.equal(await auth.hasPipelineSessionForUser(signed, "another-account"), false);
  assert.equal(await auth.hasPipelineSessionForUser(new Request("https://pipeline.invalid", { headers: { cookie: "pipeline_entra_session_v2=forged" } }), owner.id), false);
  assert.equal(await auth.hasPipelineSessionForUser(new Request("https://pipeline.invalid"), owner.id), false);
});

test("PostgreSQL activity preserves microsecond pagination, filtering, deleted workspaces and field-only projection", { skip: !process.env.PIPELINE_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Only a disposable local database is allowed");
  url.pathname = "/postgres";
  const admin = postgres(url.href, { ssl: false, max: 1, onnotice() {} });
  const name = `pipeline_activity_${process.pid}`;
  let sql;
  try {
    await admin.unsafe(`create database "${name}"`);
    url.pathname = `/${name}`;
    sql = postgres(url.href, { ssl: false, max: 1, onnotice() {} });
    for (const file of (await readdir("database/migrations")).filter((file) => file.endsWith(".sql")).sort()) await sql.unsafe(await readFile(`database/migrations/${file}`, "utf8"));
    const [{ person_id }] = await sql`insert into pipeline.people (display_name) values ('Synthetic Client') returning person_id`;
    const [{ referral_id }] = await sql`insert into pipeline.referrals (person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name, deleted_at, delete_after, deleted_by, deleted_by_name)
      values (${person_id}, 'New', 'San Pablo', 'fixture', 'Fixture', 'fixture', 'Fixture', now(), now() + interval '30 days', 'fixture', 'Fixture') returning referral_id`;
    await sql`insert into pipeline.workspace_members (principal_id, display_name, email, roles, last_seen_at) values ('fixture', 'Synthetic Assessor', 'fixture@example.invalid', ${["reviewer"]}, now())`;
    const since = "2026-09-24T00:00:00.000000Z", through = "2026-09-26T00:00:00.000000Z";
    for (let n = 0; n < 55; n++) await sql`insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, changed_fields, before_values, after_values, created_at)
      values ('referral', ${String(referral_id)}, 'referral_updated', 'fixture', 'Synthetic Assessor', ${["ssn", "owner"]}, ${sql.json({ ssn: "never expose me" })}, ${sql.json({ ssn: "nor me" })}, '2026-09-25T12:00:00.123456Z')`;
    await sql`insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, created_at)
      values ('auth_session', 'test-session', 'signed_in', 'other', 'Other Assessor', '2026-09-25T13:00:00Z'),
             ('referral', ${String(referral_id)}, 'referral_updated', 'fixture', 'Synthetic Assessor', '2026-09-23T13:00:00Z')`;
    const { getApplicationActivity } = loadEntry("lib/pipeline/application-activity.ts", { "@/lib/database/pipeline-database": { getPipelineSql: () => sql } });
    const first = await getApplicationActivity({ since, through });
    const second = await getApplicationActivity({ since, through, cursor: first.next_cursor });
    assert.equal(first.events.length, 50);
    assert.equal(second.events.length, 6);
    assert.equal(new Set([...first.events, ...second.events].map((event) => event.id)).size, 56);
    assert.equal(second.next_cursor, null);
    assert.equal(first.people.find((person) => person.id === "fixture").recorded_actions, 55);
    assert.equal(first.people.find((person) => person.id === "other").sign_ins, 1);
    const changed = first.events.find((event) => event.workspace);
    assert.equal(changed.workspace.name, "Synthetic Client");
    assert.equal(changed.workspace.deleted, true);
    assert.deepEqual([...changed.fields], ["Social Security number", "Primary assignee"]);
    assert.doesNotMatch(JSON.stringify(first), /never expose|nor me|before_values|after_values/);
    const filtered = await getApplicationActivity({ since, through, actor: "other" });
    assert.equal(filtered.events.length, 1);
    assert.equal(filtered.events[0].action, "signed_in");
    assert.equal((await getApplicationActivity({ since, through, actor: "' or 1=1 --" })).events.length, 0);
    await sql.unsafe(await readFile("database/rollbacks/0045_application_activity_index.sql", "utf8"));
    assert.equal((await sql`select to_regclass('pipeline.audit_events_created_idx') as name`)[0].name, null);
    assert.equal((await getApplicationActivity({ since, through, actor: "other" })).events.length, 1, "index rollback preserves the audit trail and read compatibility");
    await sql.unsafe(await readFile("database/migrations/0045_application_activity_index.sql", "utf8"));
    assert.ok((await sql`select to_regclass('pipeline.audit_events_created_idx') as name`)[0].name);
  } finally {
    await sql?.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});

function activityRoute(user, getApplicationActivity, ready = true) {
  return loadEntry("app/api/operations/application-activity/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: () => user ? { ok: true, user } : { ok: false, response: Response.json({}, { status: 401 }) } },
    "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ ready }) },
    "@/lib/pipeline/application-activity": { getApplicationActivity },
    "@/lib/observability/api-logging": logging,
  });
}

function request(params = "") {
  const query = new URLSearchParams({ since: new Date(Date.now() - 86400_000).toISOString() });
  for (const [key, value] of new URLSearchParams(params)) query.set(key, value);
  return new Request(`http://localhost/api/operations/application-activity?${query}`);
}
