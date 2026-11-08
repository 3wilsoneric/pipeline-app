import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";

const actor = { id: "synthetic-resident-user", name: "Synthetic User" };
const input = (key = "synthetic:first") => ({ pipeline_client_id: key, display_name: "Synthetic Client", resident_key: key,
  community_id: "337", match_method: "manual", referral_id: 1 });

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pipeline-resident-recovery-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "resident-links.json");
  const load = () => loadEntry("lib/pipeline/resident-link-store.ts", { "node:fs/promises": { ...fs, ...overrides } },
    { process: { ...process, env: { ...process.env, PIPELINE_RESIDENT_LINK_STORE_MODE: "local_file", PIPELINE_RESIDENT_LINK_STORE_PATH: filename } } });
  return { filename, load };
}

test("damaged resident-link files are never filtered or replaced by new links", async t => {
  const f = await fixture(t);
  for (const bytes of ['{"version":1,"links":[truncated', JSON.stringify({ version: 2, links: [] }),
    JSON.stringify({ version: 1, links: [{ link_id: "damaged" }] }),
    JSON.stringify({ version: 1, links: [], create_mutations: { saved: 42 } }),
    JSON.stringify({ version: 1, links: [], request_fingerprints: [] })]) {
    await fs.writeFile(f.filename, bytes);
    await assert.rejects(() => f.load().createResidentLink(input(), actor, "cannot-overwrite"));
    assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  }
});

test("a denied resident-link read preserves prior data and can recover on the same instance", async t => {
  let fail = false;
  const f = await fixture(t, { readFile: (...args) => fail ? Promise.reject(Object.assign(new Error("Synthetic denied read"), { code: "EACCES" })) : fs.readFile(...args) });
  const original = clean((await f.load().createResidentLink(input(), actor, "original")).link);
  const bytes = await fs.readFile(f.filename, "utf8"), restarted = f.load();
  fail = true;
  await assert.rejects(() => restarted.createResidentLink(input("synthetic:second"), actor, "second"));
  assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  fail = false;
  assert.deepEqual(clean(await restarted.getResidentLink(original.link_id)), original);
});

test("concurrent retries cannot acknowledge a resident link whose write failed", async t => {
  let fail = false;
  const f = await fixture(t, { writeFile: (...args) => fail ? Promise.reject(new Error("Synthetic write failure")) : fs.writeFile(...args) });
  const store = f.load(), original = clean((await store.createResidentLink(input(), actor, "original")).link);
  const bytes = await fs.readFile(f.filename, "utf8");
  fail = true;
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => store.createResidentLink(input("synthetic:second"), actor, "second")));
  assert.deepEqual(attempts.map(r => r.status), ["rejected", "rejected", "rejected"]);
  assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  assert.equal((await store.listResidentLinks()).total, 1);
  fail = false;
  const saved = await store.createResidentLink(input("synthetic:second"), actor, "second");
  assert.equal(saved.ok, true);
  assert.deepEqual(clean(await f.load().getResidentLink(original.link_id)), original);
  assert.equal((await f.load().listResidentLinks()).total, 2);
});

test("failed review rename leaves resident status, audit and version unchanged", async t => {
  let fail = false;
  const f = await fixture(t, { rename: (...args) => fail ? Promise.reject(new Error("Synthetic rename failure")) : fs.rename(...args) });
  const store = f.load(), original = clean((await store.createResidentLink(input(), actor, "original")).link);
  const bytes = await fs.readFile(f.filename, "utf8");
  fail = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(() => store.reviewResidentLink(original.link_id, { action: "confirm" }, actor, original.version));
    assert.deepEqual(clean(await store.getResidentLink(original.link_id)), original);
    assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  }
  fail = false;
  const saved = await store.reviewResidentLink(original.link_id, { action: "confirm" }, actor, original.version);
  assert.equal(saved.link.version, 2);
  assert.equal(saved.link.audit_events.length, 2);
  assert.deepEqual(clean(await f.load().getResidentLink(original.link_id)), clean(saved.link));
});

test("resident receipts bind initiating and effective accounts without binding mutable audit labels", async t => {
  const f = await fixture(t), store = f.load(), command = { resident_key: "synthetic:first" };
  const request = { principal: ["initiator-a", actor.id], command };
  const original = await store.createResidentLink(input(), actor, "delegated", request);
  const replay = await store.createResidentLink({ ...input(), display_name: "Updated server seed" }, { ...actor, name: "Updated audit label" }, "delegated", request);
  assert.deepEqual(clean(replay.link), clean(original.link));
  for (const principal of [["initiator-b", actor.id], ["initiator-a", "another-effective-user"]]) {
    await assert.rejects(() => store.createResidentLink(input(), actor, "delegated", { principal, command }), { name: "MutationReplayConflictError" });
  }
  assert.equal((await f.load().listResidentLinks()).total, 1);
});

test("a receipt whose link is missing cannot create a replacement", async t => {
  const f = await fixture(t);
  await f.load().createResidentLink(input(), actor, "missing");
  const stored = JSON.parse(await fs.readFile(f.filename, "utf8"));
  stored.links = [];
  await fs.writeFile(f.filename, JSON.stringify(stored));
  await assert.rejects(() => f.load().createResidentLink(input(), actor, "missing"), { name: "MutationReplayConflictError" });
  assert.deepEqual(JSON.parse(await fs.readFile(f.filename, "utf8")), stored);
});
