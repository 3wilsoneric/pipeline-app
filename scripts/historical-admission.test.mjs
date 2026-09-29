import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import net from "node:net";
import { join } from "node:path";
import postgres from "postgres";
import { clean, loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const load = (file, globals) => loadTypeScriptModule(root, file, globals);
const policy = load("lib/pipeline/historical-admission.ts");
const presentation = load("lib/pipeline/workspace-presentation.ts");
const actor = { id: "fixture-operator", name: "Fixture Operator" };
const fixture = {
  id: 1, clientId: "prior-fixture", version: 1, workspaceOrigin: "allo", workspaceStatus: "historical", sourceWorkspaceId: "fixture-canvas",
  name: "Synthetic Prior", dob: "1980-01-02", community: "San Pablo", date: "2025-01-01", createdAt: "2025-01-01T00:00:00Z",
  stage: "New", workflowStatus: "intake_unassigned", priority: "standard", source: "ALLO", owner: "Unassigned", tags: [], note: "Keep original notes",
  documentName: "original.pdf", documentStatus: "Uploaded", phone: "", email: "", payer: "", admissionDate: "2025-01-02",
  fieldSources: { dob: "Original chart", admissionDate: "Imported evidence" },
};
const admission = { admissionDate: "2025-02-03", community: "Turlock" };

test("historical confirmation admits only the two authorized fields, valid date, and real community", () => {
  assert.equal(policy.isHistoricalAdmissionPatch(fixture, admission), true);
  for (const patch of [{ ...admission, note: "overwrite" }, { ...admission, stage: "Accepted / Admitted" }, { admissionDate: admission.admissionDate }, { ...admission, admissionDate: "2099-01-01" }, { ...admission, admissionDate: "2025-02-30" }, { ...admission, community: "Unassigned" }]) assert.equal(policy.isHistoricalAdmissionPatch(fixture, patch), false);
  for (const ref of [{ ...fixture, workspaceStatus: "active" }, { ...fixture, workspaceOrigin: "pipeline" }, { ...fixture, deletedAt: "2026-01-01" }]) assert.equal(policy.isHistoricalAdmissionPatch(ref, admission), false);
  for (const value of [null, [], "bad", {}, { ...admission, admissionDate: 1 }]) assert.equal(policy.historicalAdmissionInput(value), null);
});

test("roster suggestions are unique, non-conflicting human-review evidence, never identity merges", () => {
  const resident = { display_name: fixture.name, date_of_birth: null, community_name: "Turlock", admit_date: "2025-02-03" };
  assert.deepEqual(clean(policy.historicalAdmissionSuggestion(fixture, [resident])), { name: fixture.name, ...admission });
  assert.equal(policy.historicalAdmissionSuggestion(fixture, [resident, resident]), null);
  assert.equal(policy.historicalAdmissionSuggestion(fixture, [{ ...resident, date_of_birth: "1990-01-01" }]), null);
  assert.equal(policy.historicalAdmissionSuggestion(fixture, [{ ...resident, admit_date: null }]), null);
  assert.equal(policy.historicalAdmissionSuggestion(fixture, [{ ...resident, community_name: "Not a community" }]), null);
  assert.equal(policy.historicalAdmissionSuggestion(fixture, [{ ...resident, display_name: "Different Person" }]), null);
});

function storeGlobals(directory, sql) {
  return {
    globalThis: { ...(sql ? { __pipelineSql: sql } : { __pipelineReferralStore: {
      initialized: true, referrals: [structuredClone(fixture)], revision: 1, nextId: 2, auditEvents: [], uploadedDocuments: [],
      createMutations: new Map(), patchMutations: new Map(), persistQueue: Promise.resolve(),
    } }) },
    process: { ...process, env: { ...process.env, NODE_ENV: "test", PIPELINE_REFERRAL_STORE_MODE: sql ? "postgres" : "local_file", PIPELINE_DATABASE_MODE: sql ? "postgres" : "disconnected",
      PIPELINE_DATABASE_URL: sql ? "postgres://fixture.invalid/unused" : "", PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"), PIPELINE_DEMO_MODE: "false", PIPELINE_PERSONA_DEMO: "false" } },
  };
}

async function exercise(store, audit) {
  await assert.rejects(store.patchReferral(1, admission, 1, actor), /Historical workspaces are read-only/);
  await assert.rejects(store.patchReferral(1, { ...admission, note: "bad" }, 1, actor, undefined, { historicalAdmissionConfirmed: true }), /Historical workspaces are read-only/);
  const before = await store.getReferral(1);
  const saved = await store.recordHistoricalAdmission(1, admission, before.version, actor, "prior-command");
  assert.equal(saved.ok, true);
  const ref = saved.referral;
  for (const key of ["id", "clientId", "workspaceStatus", "workspaceOrigin", "sourceWorkspaceId", "stage", "workflowStatus", "note", "dob", "documentName"]) assert.deepEqual(ref[key], before[key], `${key} is preserved`);
  assert.equal(ref.admissionDate, admission.admissionDate); assert.equal(ref.community, admission.community);
  assert.equal(ref.fieldSources.dob, "Original chart"); assert.equal(ref.fieldSources.admissionDate, policy.historicalAdmissionSource);
  assert.equal(ref.assessment, undefined); assert.equal(ref.admissionDecision, undefined);
  assert.equal(presentation.getWorkspaceAdmissionOutcome(ref).evidence, "recorded");
  assert.equal(presentation.getWorkspaceWorkflowLabel(ref), "Historical · Admitted");
  assert.equal((await store.listReferrals()).total, 0, "never enters new referral queues");
  const replay = await store.recordHistoricalAdmission(1, admission, before.version, actor, "prior-command");
  assert.equal(replay.ok, true); assert.equal(replay.idempotentReplay, true); assert.equal(replay.referral.version, ref.version);
  const conflict = await store.recordHistoricalAdmission(1, { ...admission, admissionDate: "2025-03-04" }, before.version, actor, "different-command");
  assert.equal(conflict.conflict, true);
  assert.equal((await store.getReferral(1)).admissionDate, admission.admissionDate);
  const events = await audit(); assert.equal(events.length, 1); assert.equal(events[0].action, "historical_admission_recorded");
  assert.equal(events[0].actor_id, actor.id); assert.equal(events[0].before_values.admissionDate, before.admissionDate);
  assert.equal(events[0].after_values.admissionDate, admission.admissionDate);
}

test("local historical admission is audited, retry-safe, conflict-safe, and preserves original work", async () => {
  const dir = await mkdtemp("/tmp/prior-admission-local-");
  try {
    const store = load("lib/pipeline/referral-store.ts", storeGlobals(dir));
    await exercise(store, () => store.listLocalReferralAuditEvents(1));
    const persisted = JSON.parse(await readFile(join(dir, "referrals.json"), "utf8"));
    assert.equal(persisted.referrals[0].admissionDate, admission.admissionDate);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("real PostgreSQL historical admission preserves records and audits atomically", { skip: process.env.PIPELINE_HISTORICAL_ADMISSION_PG_TEST !== "true" }, async () => {
  const dir = await mkdtemp("/tmp/prior-admission-pg-");
  const data = join(dir, "data"), socket = join(dir, "socket"); mkdirSync(socket);
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  let sql; let started = false;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", join(dir, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" }); started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 2, prepare: false, onnotice: () => {} });
    const migration = await sql.reserve();
    try { for (const file of (await readdir(join(root, "database/migrations"))).filter(file => file.endsWith(".sql")).sort()) await migration.unsafe(await readFile(join(root, "database/migrations", file), "utf8")); }
    finally { migration.release(); }
    const person = (await sql`insert into pipeline.people(external_client_id,display_name,date_of_birth) values ('prior-fixture', 'Synthetic Prior','1980-01-02') returning person_id`)[0].person_id;
    await sql`insert into pipeline.referrals(referral_id,person_id,stage,community,workspace_origin,workspace_status,source_workspace_id,workflow_status,data,created_by,created_by_name,updated_by,updated_by_name)
      values(1,${person},'New','San Pablo','allo','historical','fixture-canvas','intake_unassigned',${sql.json(fixture)},${actor.id},${actor.name},${actor.id},${actor.name})`;
    const store = load("lib/pipeline/referral-store.ts", storeGlobals(dir, sql));
    await exercise(store, () => sql`select * from pipeline.audit_events where entity_type='referral' and entity_id='1'`);
    assert.equal(Number((await sql`select count(*) n from pipeline.assessments`)[0].n), 0);
    assert.equal(Number((await sql`select count(*) n from pipeline.resident_links`)[0].n), 0);
    const current = await store.getReferral(1);
    const results = await Promise.all(["2025-04-01", "2025-04-02"].map((date, i) => store.recordHistoricalAdmission(1, { ...admission, admissionDate: date }, current.version, actor, `race-${i}`)));
    assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.filter(result => result.conflict).length, 1);
    // Reject the audit write and prove the referral update rolls back with it.
    await sql`alter table pipeline.audit_events add constraint fixture_reject_actor check(actor_id <> 'reject-fixture')`;
    const before = await store.getReferral(1);
    await assert.rejects(store.recordHistoricalAdmission(1, { ...admission, admissionDate: "2025-05-01" }, before.version, { id: "reject-fixture", name: "Rejected fixture" }, "reject-command"));
    assert.deepEqual(clean(await store.getReferral(1)), clean(before));
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(dir, { recursive: true, force: true });
  }
});

test("historical admission API requires access, origin, explicit confirmation, version and retry identity", async () => {
  let user = { ...actor, accessScope: "pipeline", roles: ["reviewer"] }; let current = fixture; let writes = 0;
  const routes = loadEntry("app/api/referrals/[referralId]/historical-admission/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: () => user ? { ok: true, user } : { ok: false, response: Response.json({}, { status: 401 }) } },
    "@/lib/auth/assessor-session-policy": { pipelineAuditActor: user => ({ id: user.id, name: user.name }) },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, fn) => fn() },
    "@/lib/pipeline/referral-access": { requireReferralAccess: async (_user, id) => id === 1 ? { ok: true, referral: current } : { ok: false, response: Response.json({}, { status: 404 }) }, canRecordAdmissionDecision: () => true },
    "@/lib/pipeline/referral-store": { requireReferralStore: () => ({ ok: true }), recordHistoricalAdmission: async (_id, value, version, who) => { writes++; assert.deepEqual(clean(who), actor); assert.equal(version, 1); return { ok: true, referral: { ...fixture, ...value } }; } },
    "@/lib/clinical/clinical-data": { getClinicalRoster: async () => { throw new Error("synthetic unavailable"); } },
  });
  const context = { params: Promise.resolve({ referralId: "1" }) };
  const request = (value, origin = "http://localhost") => new Request("http://localhost/api/referrals/1/historical-admission", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const valid = { ...admission, confirmed: true, if_match: 1, client_mutation_id: "fixture-confirm" };
  for (const bad of [null, {}, { ...valid, confirmed: false }, { ...valid, if_match: 0 }, { ...valid, client_mutation_id: undefined }, { ...valid, admissionDate: "2099-01-01" }]) assert.equal((await routes.POST(request(bad), context)).status, 400);
  assert.equal((await routes.POST(request(valid, "https://other.invalid"), context)).status, 403);
  user = null; assert.equal((await routes.POST(request(valid), context)).status, 401);
  user = { ...actor, roles: ["reviewer"] }; current = { ...fixture, workspaceStatus: "active" };
  assert.equal((await routes.POST(request(valid), context)).status, 422);
  current = fixture; assert.equal(writes, 0);
  assert.deepEqual(await (await routes.GET(new Request("http://localhost/api/referrals/1/historical-admission"), context)).json(), { suggestion: null, available: false });
  assert.equal((await routes.POST(request(valid), context)).status, 200); assert.equal(writes, 1, "manual confirmation is independent of the failed roster lookup");
});
