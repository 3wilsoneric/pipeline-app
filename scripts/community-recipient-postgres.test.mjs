import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { clean, loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const model = loadTypeScriptModule(root, "lib/pipeline/community-recipient-lists.ts");
const config = loadTypeScriptModule(root, "lib/pipeline/community-config.ts");
const access = loadTypeScriptModule(root, "lib/pipeline/report-access.ts");
const recipients = (name) => ({ to: [{ name, email: `${name.toLowerCase()}@example.test` }], cc: [] });

test("only named supervisor accounts manage lists; readers and unrelated coordinators do not", () => {
  for (const email of ["andrew@aaahealthservices.com", "sandeep@aaahealthservices.com", "ericwilsonalamo@outlook.com"]) {
    assert.equal(access.canManageCommunityContactLists({ id: "real-user", email, roles: ["assessment_coordinator"] }), true);
    assert.equal(access.canManageCommunityContactLists({ id: "real-user", email, roles: ["viewer"] }), false);
  }
  assert.equal(access.canManageCommunityContactLists({ id: "other", email: "other@example.test", roles: ["admin"] }), false);
  assert.equal(access.canManageCommunityContactLists({ id: "practice-supervisor", email: "supervisor@pipeline.example", roles: ["admin"], demoPersona: "supervisor" }), true);
  assert.equal(access.canManageCommunityContactLists(null), false);
});

// Opt-in creates its own loopback cluster, ignoring every configured database URL.
test("shared community lists: seed once, concurrent saves, replay, history and rollback safety", { skip: process.env.PIPELINE_COMMUNITY_LIST_POSTGRES !== "true" }, async (t) => {
  const directory = mkdtempSync("/tmp/pipeline-community-list-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  mkdirSync(socket);
  let started = false;
  let sql;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const port = await availablePort();
    execFileSync("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    const options = { host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, prepare: false, onnotice: () => undefined };
    const migration = postgres({ ...options, max: 1 });
    try {
      for (const file of ["0001_pipeline_core.sql", "0041_community_recipient_lists.sql"]) await migration.unsafe(readFileSync(join(root, "database/migrations", file), "utf8"));
    } finally { await migration.end(); }
    sql = postgres({ ...options, max: 5 });
    const store = () => loadEntry("lib/pipeline/community-recipient-list-postgres.ts", {
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
      "./community-recipient-lists": model, "./community-config": config,
    });
    const initial = config.pipelineCommunities.filter((community) => community !== "Unassigned").map((community) => ({ community, version: 1, ...recipients("Initial"), sourceDates: ["2026-09-15"], updatedAt: null }));
    const seed = async () => initial;
    await Promise.all([store().readSharedCommunityLists(seed), store().readSharedCommunityLists(seed)]);
    assert.equal((await sql`select count(*)::int as n from pipeline.community_recipient_list_versions`)[0].n, 5);
    await assert.rejects(store().saveSharedCommunityList({ community: "San Pablo", version: 1, recipients: { to: "invalid", cc: [] }, mutationId: crypto.randomUUID(), actorId: "andrew" }));
    const make = (name) => ({ community: "San Pablo", version: 1, recipients: recipients(name), mutationId: crypto.randomUUID(), actorId: name });
    const commands = [make("Andrew"), make("Sandeep")];
    const results = await Promise.all(commands.map((command) => store().saveSharedCommunityList(command)));
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.find((result) => !result.ok).status, 409);
    const index = results.findIndex((result) => result.ok);
    const winner = commands[index];
    const replay = await store().saveSharedCommunityList(winner);
    assert.deepEqual(clean(replay), clean(results[index]));
    assert.equal((await store().saveSharedCommunityList({ ...winner, recipients: recipients("Changed") })).status, 409);
    const noSeed = () => { throw new Error("Source file must not be reread after initialization."); };
    const loaded = await store().readSharedCommunityLists(noSeed);
    assert.equal(loaded.find((list) => list.community === "San Pablo").to[0].name, winner.actorId);
    const history = await sql`select * from pipeline.community_recipient_list_versions where community = 'San Pablo' order by version`;
    assert.equal(history.length, 2);
    assert.equal(history[0].recipients.to[0].name, "Initial");
    assert.equal(history[1].actor_id, winner.actorId);
    assert.deepEqual(history[1].source_dates, ["2026-09-15"]);
    await sql.unsafe(`create function pipeline.reject_list_save() returns trigger language plpgsql as $$ begin raise exception 'Synthetic storage failure'; end $$; create trigger reject_list_save before insert on pipeline.community_recipient_list_versions for each row execute function pipeline.reject_list_save()`);
    await assert.rejects(store().saveSharedCommunityList({ ...make("Retry"), version: 2 }), /Synthetic storage failure/);
    assert.equal((await sql`select count(*)::int as n from pipeline.community_recipient_list_versions where community = 'San Pablo'`)[0].n, 2);
    await sql.unsafe("drop trigger reject_list_save on pipeline.community_recipient_list_versions");
    const rollback = postgres({ ...options, max: 1 });
    try { await assert.rejects(rollback.unsafe(readFileSync(join(root, "database/rollbacks/0041_community_recipient_lists.sql"), "utf8")), /contain data/); }
    finally { await rollback.unsafe("rollback"); await rollback.end(); }
    assert.equal((await store().readSharedCommunityLists(noSeed)).length, 5);
    t.diagnostic("Only a disposable local PostgreSQL cluster was used.");
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close((error) => error ? reject(error) : resolve(port)); });
  });
}
