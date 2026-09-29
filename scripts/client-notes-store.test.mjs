import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { actor, clean, loadEntry, root } from "./contact-import-fixtures.mjs";

const noteModel = loadEntry("lib/pipeline/client-notes.ts");

test("one editor carries every existing topic note and picks up later legacy edits", () => {
  const [first, second] = noteModel.noteHeadings();
  const entries = {
    [first.key]: { body: "First saved note", saved: "First saved note", updated_at: "2026-09-28T10:00:00Z" },
    [second.key]: { body: "Second saved note", saved: "Second saved note", updated_at: "2026-09-28T11:00:00Z" },
  };
  const merged = noteModel.combinedClientNote(entries);
  assert.equal(merged, `${first.label}\nFirst saved note\n\n${second.label}\nSecond saved note`);
  entries.notes = { body: merged, saved: merged, updated_at: "2026-09-28T12:00:00Z" };
  assert.equal(noteModel.combinedClientNote(entries), merged);
  entries[second.key] = { ...entries[second.key], body: "Later saved note", saved: "Later saved note", updated_at: "2026-09-28T13:00:00Z" };
  assert.equal(noteModel.combinedClientNote(entries), `${merged}\n\n${second.label}\nLater saved note`);
  entries.notes = { ...entries.notes, body: `${merged}\n\n${second.label}\nLater saved note`, saved: merged };
  assert.equal(noteModel.combinedClientNote(entries), entries.notes.body, "typing must not duplicate the carried note");
  entries.notes = { ...entries.notes, body: merged, saved: merged };
  entries[second.key] = { ...entries[second.key], body: "Recovered unsaved note", saved: "Second saved note", updated_at: "2026-09-28T11:00:00Z" };
  assert.equal(noteModel.combinedClientNote(entries), `${merged}\n\n${second.label}\nRecovered unsaved note`, "older offline drafts remain visible");
});

function store({ sql, fs } = {}) {
  return loadEntry("lib/pipeline/client-notes-store.ts", {
    "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
    "@/lib/pipeline/referral-store": { getReferralStoreReadiness: () => ({ mode: sql ? "postgres" : "local_file" }) },
    ...(fs ? { "node:fs/promises": fs } : {}),
  });
}

test("notes never turn corrupt/unreadable local storage into an empty record", async () => {
  for (const error of [new SyntaxError("invalid JSON"), Object.assign(new Error("denied"), { code: "EACCES" })]) {
    const notes = store({ fs: { readFile: async () => { throw error; } } });
    await assert.rejects(notes.listClientNotes(42), { message: error.message });
  }
});

test("a failed local persist does not advance the cached note or version; retry is safe", async () => {
  let fail = true;
  const notes = store({ fs: {
    readFile: async () => JSON.stringify({ schema: 1, blocks: [] }), mkdir: async () => {},
    writeFile: async () => { if (fail) throw new Error("disk full"); }, rename: async () => {},
  } });
  await assert.rejects(notes.saveClientNote(42, "before", "Synthetic", 0, actor), /disk full/);
  assert.deepEqual(clean(await notes.listClientNotes(42)), []);
  fail = false;
  assert.equal((await notes.saveClientNote(42, "before", "Synthetic", 0, actor)).block.version, 1);
  assert.equal((await notes.saveClientNote(42, "before", "Stale", 0, actor)).ok, false);
});

test("real PostgreSQL notes migration, runtime permissions, routes, races and rollback preservation", {
  skip: process.env.PIPELINE_CLIENT_NOTES_POSTGRES !== "true",
}, async (t) => {
  // Always create a disposable database. Never read application .env or connect
  // to production: CI's explicitly identified loopback service or a new cluster.
  const directory = await mkdtemp("/tmp/pipeline-notes-pg-");
  const data = join(directory, "data"), socket = join(directory, "socket");
  const binary = (name) => join(process.env.PIPELINE_CLIENT_NOTES_PG_BIN || "/opt/homebrew/opt/postgresql@16/bin", name);
  let started = false, admin, migration, runtime;
  const suffix = `${process.pid}_${Date.now()}`;
  const database = `notes_${suffix}`, migrator = `notes_migrator_${suffix}`, reader = `notes_runtime_${suffix}`;
  let options;
  try {
    if (process.env.PIPELINE_TEST_DATABASE_URL) {
      const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
      assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.username === "pipeline_ci" && url.pathname === "/pipeline_ci"
        && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE === "true", "Only the explicit disposable CI PostgreSQL service is accepted");
      options = { host: url.hostname, port: Number(url.port || 5432), username: url.username, password: url.password, database: "pipeline_ci" };
    } else {
      await mkdir(socket);
      execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
      const port = await availablePort();
      execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
      started = true;
      options = { host: "127.0.0.1", port, username: process.env.USER, database: "postgres" };
    }
    const connect = (overrides = {}) => postgres({ ...options, ssl: false, max: 8, prepare: false, onnotice: () => {}, ...overrides });
    admin = connect();
    await admin.unsafe(`create role ${migrator} login password 'notes-test-only'; create role ${reader} login password 'notes-test-only'`);
    await admin.unsafe(`create database ${database} owner ${migrator}`);
    migration = connect({ database, username: migrator, password: "notes-test-only", max: 1 });
    runtime = connect({ database, username: reader, password: "notes-test-only" });
    await migration.unsafe(`create schema pipeline authorization ${migrator}; grant usage on schema pipeline to ${reader};
      alter default privileges for role ${migrator} in schema pipeline grant select, insert, update, delete on tables to ${reader};
      alter default privileges for role ${migrator} in schema pipeline grant usage, select, update on sequences to ${reader}`);
    for (const name of ["0001_pipeline_core.sql", "0003_operational_hardening.sql", "0046_client_notes.sql"]) {
      await migration.unsafe(await readFile(join(root, "database/migrations", name), "utf8"));
    }
    assert.equal((await runtime`select migration_id from pipeline.schema_migrations where migration_id = '0046_client_notes'`).length, 1);
    await assert.rejects(runtime.unsafe("create table pipeline.forbidden_fixture (id int)"), /permission denied/);
    const person = (await runtime`insert into pipeline.people(display_name) values ('Synthetic notes fixture') returning person_id`)[0];
    const referral = (await runtime`insert into pipeline.referrals(person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name)
      values (${person.person_id}, 'New', 'Fixture', ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}) returning referral_id, version`)[0];
    const id = Number(referral.referral_id), notes = store({ sql: runtime });
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => notes.saveClientNote(id, "before", `Fixture ${i}`, 0, actor)));
    assert.equal(concurrent.filter((result) => result.ok).length, 1);
    assert.equal((await notes.listClientNotes(id))[0].version, 1);
    assert.ok(concurrent.filter((result) => !result.ok).every((result) => result.block.version === 1));
    await notes.saveClientNote(id, "collateral", "Independent heading", 0, actor);
    assert.equal((await runtime`select version from pipeline.referrals where referral_id = ${id}`)[0].version, referral.version);
    assert.equal((await notes.saveClientNote(id, "before", "Stale", 0, actor)).ok, false);
    assert.equal((await notes.saveClientNote(id, "before", "Latest fixture", 1, actor)).block.version, 2);
    assert.equal((await notes.latestClientNotes([id]))[0].text, "Latest fixture");

    const dependencies = {
      "@/lib/pipeline/client-notes-store": notes,
      "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => ({ ok: true, user: actor }) },
      "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => actor },
      "@/lib/observability/api-logging": { withApiLogging: (_request, _route, work) => work() },
      "@/lib/pipeline/referral-access": { requireReferralAccess: async () => ({ ok: true }), requireMutableReferralAccess: async () => ({ ok: true }) },
    };
    const put = loadEntry("app/api/referrals/[referralId]/notes/[headingKey]/route.ts", dependencies);
    const get = loadEntry("app/api/referrals/[referralId]/notes/route.ts", dependencies);
    const context = { params: Promise.resolve({ referralId: String(id), headingKey: "before" }) };
    const request = (body, version) => new Request(`http://localhost/api/referrals/${id}/notes/before`, { method: "PUT", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify({ body, if_match: version }) });
    assert.equal((await put.PUT(request("Route write", 2), context)).status, 200);
    assert.equal((await put.PUT(request("Stale route write", 2), context)).status, 409);
    assert.equal((await put.PUT(request("x".repeat(20001), 3), context)).status, 400);
    const read = await get.GET(new Request("http://localhost"), context);
    assert.equal((await read.json()).blocks.find((block) => block.block_key === "before").body, "Route write");
    const combined = "Before the interview\nRoute write\n\nCollateral and calls\nIndependent heading";
    assert.equal((await notes.saveClientNote(id, "notes", combined, 0, actor)).ok, true);
    assert.equal((await notes.latestClientNotes([id]))[0].text, "Route write");
    assert.equal((await notes.saveClientNote(id, "notes", "", 1, actor)).ok, true);
    assert.deepEqual(clean(await notes.latestClientNotes([id])), [], "clearing the unified note must not resurrect archived topic text");
    const rollback = await readFile(join(root, "database/rollbacks/0046_client_notes.sql"), "utf8");
    await assert.rejects(migration.unsafe(rollback), /notes|rows|empty/i);
    await migration.unsafe("rollback");
    assert.equal((await notes.listClientNotes(id)).length, 3, "app rollback keeps every original note and the unified note");
    t.diagnostic("Migration and note routes exercised on real PostgreSQL through a non-owner runtime role.");
  } finally {
    await runtime?.end({ timeout: 5 }); await migration?.end({ timeout: 5 });
    if (admin) {
      await admin.unsafe(`drop database if exists ${database} with (force)`);
      await admin.unsafe(`drop role if exists ${reader}; drop role if exists ${migrator}`);
      await admin.end({ timeout: 5 });
    }
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    await rm(directory, { recursive: true, force: true });
  }
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port)); });
  });
}
