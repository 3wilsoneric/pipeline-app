import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pipeline-workspace-recovery-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "workspace.json");
  const load = () => loadEntry("lib/pipeline/user-workspace-state-store.ts", {
    "node:fs/promises": { ...fs, ...overrides },
    "@/lib/auth/pipeline-auth": { getPipelineAuthMode: () => "trusted_headers" },
    "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ mode: "disconnected" }) },
    "@/lib/desktop/desktop-server-config": { isPipelineDesktopStateEnabled: () => true },
  }, { globalThis: {}, process: { ...process, env: { ...process.env, NODE_ENV: "test", NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED: "true",
    PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: "true", PIPELINE_DESKTOP_STATE_STORE_PATH: filename } } });
  return { filename, load };
}
const command = (expectedVersion = 0, payload = { answer: "Preserved synthetic draft" }, principalId = "synthetic-a") => ({ principalId, kind: "assessment_draft", key: "asm_synthetic", expectedVersion, payload, ttlDays: 30 });
const read = (store, principal = "synthetic-a") => store.getUserWorkspaceState(principal, "assessment_draft", "asm_synthetic");

test("unsupported, malformed and duplicate workspace records fail closed without filtering or replacing bytes", async t => {
  const f = await fixture(t);
  const store = f.load();
  await store.putUserWorkspaceState(command());
  const valid = JSON.parse(await fs.readFile(f.filename, "utf8"));
  for (const invalid of [{ schema: 2, records: [] }, { schema: 1, records: {} },
    { schema: 1, records: [valid.records[0], { bad: true }] }, { schema: 1, records: [valid.records[0], valid.records[0]] }]) {
    const bytes = JSON.stringify(invalid);
    await fs.writeFile(f.filename, bytes);
    await assert.rejects(() => f.load().putUserWorkspaceState(command(0, {}, "synthetic-b")));
    assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  }
});

test("a failed draft write rolls back cached version and payload and allows the original CAS retry", async t => {
  let fail = false;
  const f = await fixture(t, { rename: (...args) => fail ? Promise.reject(new Error("Synthetic disk failure")) : fs.rename(...args) });
  const store = f.load();
  const first = await store.putUserWorkspaceState(command());
  const bytes = await fs.readFile(f.filename, "utf8");
  fail = true;
  await assert.rejects(() => store.putUserWorkspaceState(command(1, { answer: "Uncommitted" })), /Synthetic disk failure/);
  assert.deepEqual(clean(await read(store)), clean(first.state));
  assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  fail = false;
  const saved = await store.putUserWorkspaceState(command(1, { answer: "Recovered" }));
  assert.equal(saved.ok, true); assert.equal(saved.state.version, 2);
  assert.deepEqual(clean(await read(f.load())), clean(saved.state));
});

for (const mode of ["versioned", "bulk", "trim", "expired"]) {
  test(`failed ${mode} deletion preserves cached and durable workspace state`, async t => {
    let fail = false;
    const f = await fixture(t, { rename: (...args) => fail ? Promise.reject(new Error("Synthetic deletion failure")) : fs.rename(...args) });
    const store = f.load();
    await store.putUserWorkspaceState({ ...command(), ttlDays: mode === "expired" ? -1 : 30 });
    const before = await fs.readFile(f.filename, "utf8");
    const remove = () => mode === "versioned" ? store.deleteVersionedUserWorkspaceState("synthetic-a", "assessment_draft", "asm_synthetic", 1)
      : mode === "bulk" ? store.deleteUserWorkspaceState("synthetic-a", "assessment_draft")
      : mode === "trim" ? store.trimUserWorkspaceState("synthetic-a", "assessment_draft", 0)
      : store.pruneExpiredUserWorkspaceState(100, false);
    fail = true;
    await assert.rejects(remove, /Synthetic deletion failure/);
    assert.equal(await fs.readFile(f.filename, "utf8"), before);
    if (mode !== "expired") assert.ok(await read(store));
    else assert.equal((await store.pruneExpiredUserWorkspaceState(100, true)).eligible, 1);
    fail = false;
    await remove();
    assert.equal((JSON.parse(await fs.readFile(f.filename, "utf8"))).records.length, 0);
  });
}

test("a queued successful account write cannot commit another account's failed draft", async t => {
  let failOnce = false;
  const f = await fixture(t, { rename: (...args) => { if (failOnce) { failOnce = false; throw new Error("Synthetic write failure"); } return fs.rename(...args); } });
  const store = f.load();
  await store.putUserWorkspaceState(command());
  failOnce = true;
  const results = await Promise.allSettled([store.putUserWorkspaceState(command(1, { answer: "Must not commit" })), store.putUserWorkspaceState(command(0, { answer: "Other account" }, "synthetic-b"))]);
  assert.deepEqual(results.map(result => result.status), ["rejected", "fulfilled"]);
  assert.equal((await read(store)).payload.answer, "Preserved synthetic draft");
  const restarted = f.load();
  assert.equal((await read(restarted)).payload.answer, "Preserved synthetic draft");
  assert.equal((await read(restarted, "synthetic-b")).payload.answer, "Other account");
});

test("reads cannot report an uncommitted draft while its replacement is pending", async t => {
  let intercept = async () => {};
  const f = await fixture(t, { rename: async (...args) => { await intercept(); return fs.rename(...args); } });
  const store = f.load(); await store.putUserWorkspaceState(command());
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  intercept = async () => { entered(); await gate; };
  const saving = store.putUserWorkspaceState(command(1, { answer: "Pending" }));
  await ready;
  let readFinished = false;
  const reading = read(store).then(value => { readFinished = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 10));
  const leaked = readFinished;
  release();
  const [, saved] = await Promise.all([saving, reading]);
  assert.equal(leaked, false);
  assert.equal(saved.payload.answer, "Pending");
});

test("a reused temporary file cannot expose workspace drafts through broad permissions", async t => {
  const f = await fixture(t);
  await fs.writeFile(`${f.filename}.${process.pid}.tmp`, "Old temporary bytes", { mode: 0o644 });
  await f.load().putUserWorkspaceState(command());
  assert.equal((await fs.stat(f.filename)).mode & 0o777, 0o600);
});
