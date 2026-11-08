import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clean, loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const actor = { id: "synthetic-recovery-user", name: "Synthetic User" };
const input = (name = "Original Synthetic") => ({ name, date: "2026-11-07", createdAt: "2026-11-07T00:00:00Z", stage: "New",
  community: "San Pablo", county: "Contra Costa County", source: "Synthetic", priority: "standard", tags: [], owner: "Unassigned",
  note: "", dob: "1980-01-01", phone: "", email: "", payer: "" });

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pipeline-referral-recovery-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "referrals.json");
  const load = () => {
    const globals = { globalThis: {}, process: { ...process, env: { ...process.env,
      PIPELINE_REFERRAL_STORE_MODE: "local_file", PIPELINE_REFERRAL_STORE_PATH: filename,
      PIPELINE_ASSESSMENT_STORE_PATH: path.join(directory, "assessments.json"),
    } } };
    const io = { "node:fs/promises": { ...fs, ...overrides } };
    const localMutation = loadEntry("lib/persistence/local-mutation.ts", io, globals);
    return loadEntry("lib/pipeline/referral-store.ts", { ...io, "@/lib/persistence/local-mutation": localMutation }, globals);
  };
  return { filename, load };
}

test("a damaged referral file cannot be replaced by a successful create", async (t) => {
  const f = await fixture(t);
  const corrupt = '{"version":1,"referrals":[truncated';
  await fs.writeFile(f.filename, corrupt);
  const store = f.load();
  await assert.rejects(() => store.createReferral(input(), "cannot-overwrite", actor));
  assert.equal(await fs.readFile(f.filename, "utf8"), corrupt);
  await fs.writeFile(f.filename, JSON.stringify({ version: 1, revision: 0, next_id: 1, referrals: [] }));
  assert.equal((await store.createReferral(input(), "recovered", actor)).referral.name, "Original Synthetic");
});

test("a transient read failure preserves existing referrals and allows a later recovery", async (t) => {
  let failRead = false;
  const f = await fixture(t, { readFile: (...args) => failRead ? Promise.reject(Object.assign(new Error("Synthetic read failure"), { code: "EACCES" })) : fs.readFile(...args) });
  const { referral } = await f.load().createReferral(input(), "original", actor);
  const original = clean(await f.load().getReferral(referral.id));
  const bytes = await fs.readFile(f.filename, "utf8");
  failRead = true;
  const restarted = f.load();
  await assert.rejects(() => restarted.createReferral(input("Another Synthetic"), "another", actor));
  assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  failRead = false;
  assert.deepEqual(clean(await restarted.getReferral(referral.id)), original);
});

test("concurrent create retries cannot acknowledge a failed write and recovered writes preserve prior data", async (t) => {
  let failWrite = false;
  const f = await fixture(t, { writeFile: (...args) => failWrite ? Promise.reject(new Error("Synthetic write failure")) : fs.writeFile(...args) });
  const store = f.load();
  const { referral } = await store.createReferral(input(), "original", actor);
  const original = clean(await f.load().getReferral(referral.id));
  const bytes = await fs.readFile(f.filename, "utf8");
  failWrite = true;
  const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => store.createReferral(input("Unsaved Synthetic"), "failed", actor)));
  assert.deepEqual(attempts.map(attempt => attempt.status), ["rejected", "rejected", "rejected"]);
  assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  failWrite = false;
  const saved = await store.createReferral(input("Recovered Synthetic"), "failed", actor);
  assert.equal(saved.referral.name, "Recovered Synthetic");
  const reopened = f.load();
  assert.deepEqual(clean(await reopened.getReferral(referral.id)), original);
  assert.equal((await reopened.getReferral(saved.referral.id)).name, "Recovered Synthetic");
  assert.equal((await reopened.listReferrals()).total, 2);
});

test("referral assignment and assessment edits share a reentrant queue without opposite lock ordering", { timeout: 10_000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pipeline-cross-store-mutation-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const globals = { globalThis: {}, process: { ...process, env: { ...process.env,
    PIPELINE_DATABASE_MODE: "disconnected", PIPELINE_REFERRAL_STORE_MODE: "local_file", PIPELINE_ASSESSMENT_STORE_MODE: "local_file",
    PIPELINE_REFERRAL_STORE_PATH: path.join(directory, "referrals.json"), PIPELINE_ASSESSMENT_STORE_PATH: path.join(directory, "assessments.json"),
  } } };
  const referrals = loadTypeScriptModule(root, "lib/pipeline/referral-store.ts", globals);
  const assessments = loadTypeScriptModule(root, "lib/assessment/assessment-store.ts", globals);
  const schema = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts", globals);
  const { referral } = await referrals.createReferral({ ...input(), owner: actor.name, ownerId: actor.id }, "concurrent-root", actor);
  const { assessment } = await assessments.createAssessment({ referral_id: referral.id, assigned_assessor: actor,
    data: { ...schema.createEmptyAssessmentToolData(), assessment_notes: "Preserve this original answer" } }, actor, "concurrent-assessment");
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await referrals.getReferral(referral.id);
    const assignee = { id: `synthetic-owner-${attempt}`, name: `Synthetic Owner ${attempt}` };
    const [answer, assignment] = await Promise.all([
      assessments.patchAssessment(assessment.assessment_id, { data: { current_symptoms: `Synthetic answer ${attempt}` } }, actor),
      referrals.patchReferral(referral.id, { owner: assignee.name, ownerId: assignee.id }, current.version, actor,
        { intake: current.sectionVersions.intake, workflow: current.sectionVersions.workflow }),
    ]);
    assert.equal(answer.ok, true);
    if (!assignment.ok) {
      assert.equal(assignment.conflict, true);
      const latest = await referrals.getReferral(referral.id);
      const retry = await referrals.patchReferral(referral.id, { owner: assignee.name, ownerId: assignee.id }, latest.version, actor);
      assert.equal(retry.ok, true);
    }
    const saved = await assessments.getAssessment(assessment.assessment_id);
    assert.equal(saved.assessor_id, assignee.id);
    assert.equal(saved.assessment_notes, "Preserve this original answer");
    assert.equal(saved.current_symptoms, `Synthetic answer ${attempt}`);
    assert.equal((await referrals.getReferral(referral.id)).ownerId, assignee.id);
  }
});

test("invalid referral and audit records fail closed without filtering saved history", async (t) => {
  const f = await fixture(t);
  for (const saved of [
    { version: 2, referrals: [] },
    { version: 1, referrals: {} },
    { version: 1, referrals: [{ id: 1, name: "Damaged Synthetic" }] },
    { version: 1, referrals: [], audit_events: [{ audit_event_id: "incomplete" }] },
  ]) {
    const bytes = JSON.stringify(saved);
    await fs.writeFile(f.filename, bytes);
    await assert.rejects(() => f.load().createReferral(input(), "cannot-filter", actor), /referral store is invalid/);
    assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  }
});

test("failed referral rename restores values, version, audit and retry receipt before a recovered save", async (t) => {
  let failRename = false;
  const f = await fixture(t, { rename: (...args) => failRename ? Promise.reject(new Error("Synthetic rename failure")) : fs.rename(...args) });
  const store = f.load();
  const { referral } = await store.createReferral(input(), "for-patch", actor);
  const before = clean(await store.getReferral(referral.id));
  const bytes = await fs.readFile(f.filename, "utf8");
  const patch = { note: "Recovered synthetic note" };
  failRename = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(() => store.patchReferral(referral.id, patch, referral.version, actor, undefined, { mutationId: "patch" }), /Synthetic rename failure/);
    assert.deepEqual(clean(await store.getReferral(referral.id)), before);
    assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  }
  failRename = false;
  const result = await store.patchReferral(referral.id, patch, referral.version, actor, undefined, { mutationId: "patch" });
  assert.equal(result.ok, true);
  assert.equal(result.referral.version, referral.version + 1);
  assert.deepEqual(clean(await f.load().getReferral(referral.id)), clean(result.referral));
});

test("an error clearing the committed journal preserves the receipt for a neutral retry", async (t) => {
  let failCleanup = true;
  const f = await fixture(t, { unlink: (filename, ...args) => failCleanup && filename.endsWith(".transaction.json")
    ? Promise.reject(new Error("Synthetic post-commit cleanup failure")) : fs.unlink(filename, ...args) });
  const store = f.load();
  await assert.rejects(() => store.createReferral(input(), "committed", actor), /post-commit/);
  const committed = JSON.parse(await fs.readFile(f.filename, "utf8"));
  assert.equal(committed.referrals.length, 1);
  failCleanup = false;
  const retry = await store.createReferral(input(), "committed", actor);
  assert.equal(retry.idempotentReplay, true);
  assert.equal(retry.referral.id, committed.referrals[0].id);
  assert.deepEqual(clean(await f.load().getReferral(retry.referral.id)), clean(retry.referral));
  assert.equal(JSON.parse(await fs.readFile(f.filename, "utf8")).audit_events.length, 1);
});
