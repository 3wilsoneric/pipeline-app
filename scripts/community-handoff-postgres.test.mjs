import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadEntry, root } from "./contact-import-fixtures.mjs";

// Disposable loopback cluster only. Never reads the application's database URL.
test("recipient drafts: migrated PostgreSQL persistence, private ownership, concurrent CAS and non-destructive rollback", { skip: process.env.PIPELINE_HANDOFF_POSTGRES !== "true" }, async () => {
  const directory = mkdtempSync("/tmp/pipeline-handoff-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  const binary = (name) => process.env.PIPELINE_HANDOFF_PG_BIN ? join(process.env.PIPELINE_HANDOFF_PG_BIN, name) : name;
  let started = false;
  let sql;
  try {
    mkdirSync(socket);
    execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 4, prepare: false, onnotice: () => {} });
    const url = `postgres://${encodeURIComponent(process.env.USER)}@127.0.0.1:${port}/postgres`;
    for (const name of ["0001_pipeline_core", "0006_user_workspace_state", "0033_workflow_continuity", "0040_referral_email_drafts"]) {
      execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", join(root, "database/migrations", `${name}.sql`)], { stdio: "pipe" });
    }
    const dependencies = {
      "@/lib/auth/pipeline-auth": { getPipelineAuthMode: () => "entra_jwt" },
      "@/lib/desktop/desktop-server-config": { isPipelineDesktopStateEnabled: () => false },
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql, getPipelineDatabaseReadiness: () => ({ mode: "postgres", ready: true }) },
    };
    const owner = () => loadEntry("lib/pipeline/user-workspace-state-store.ts", dependencies, { process: { ...process, env: { NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true" } } });
    const store = owner();
    const input = { principalId: "synthetic-a", kind: "referral_email_draft", key: "7", payload: { community: "San Pablo", to: [{ name: "Team", email: "team@example.invalid" }], cc: [] }, expectedVersion: 0, ttlDays: 30 };
    assert.equal((await store.putUserWorkspaceState(input)).ok, true);
    assert.equal((await owner().getUserWorkspaceState(input.principalId, input.kind, input.key)).version, 1);
    assert.equal(await store.getUserWorkspaceState("synthetic-b", input.kind, input.key), null);
    assert.equal((await store.putUserWorkspaceState(input)).ok, false);
    const outcomes = await Promise.all([store.putUserWorkspaceState({ ...input, expectedVersion: 1 }), owner().putUserWorkspaceState({ ...input, expectedVersion: 1 })]);
    assert.equal(outcomes.filter((item) => item.ok).length, 1);
    assert.equal((await owner().getUserWorkspaceState(input.principalId, input.kind, input.key)).version, 2);
    const rollback = join(root, "database/rollbacks/0040_referral_email_drafts.sql");
    assert.throws(() => execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", rollback], { stdio: "pipe" }));
    assert.equal((await store.getUserWorkspaceState(input.principalId, input.kind, input.key)).version, 2);
    assert.equal((await sql`select 1 from pipeline.schema_migrations where migration_id = '0040_referral_email_drafts'`).length, 1);
    await sql`delete from pipeline.user_workspace_state where state_kind = 'referral_email_draft'`;
    execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", rollback], { stdio: "pipe" });
    assert.equal((await sql`select 1 from pipeline.schema_migrations where migration_id = '0040_referral_email_drafts'`).length, 0);
    await assert.rejects(() => store.putUserWorkspaceState(input), { code: "23514" });
    assert.ok(readFileSync(rollback, "utf8").includes("Never delete recipient drafts"));
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});
