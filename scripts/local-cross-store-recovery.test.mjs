import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clean, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const require = createRequire(import.meta.url);
const actor = { id: "synthetic-cross-store", name: "Synthetic Assessor" };
const referralInput = {
  name: "Synthetic Original", date: "2026-11-07", createdAt: "2026-11-07T00:00:00Z", stage: "New",
  community: "San Pablo", county: "Contra Costa County", source: "Synthetic", priority: "standard", tags: [],
  owner: actor.name, ownerId: actor.id, note: "", dob: "1980-01-01", phone: "", email: "", payer: "",
};

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pipeline-cross-store-recovery-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const paths = { referrals: path.join(directory, "referrals.json"), assessments: path.join(directory, "assessments.json") };
  let failure;
  let beforeRename = async () => {};
  let journalReads = 0;
  const load = () => {
    const globals = { globalThis: {}, crypto: globalThis.crypto, process: { ...process, env: { ...process.env,
      PIPELINE_DATABASE_MODE: "disconnected", PIPELINE_REFERRAL_STORE_MODE: "local_file", PIPELINE_ASSESSMENT_STORE_MODE: "local_file",
      PIPELINE_REFERRAL_STORE_PATH: paths.referrals, PIPELINE_ASSESSMENT_STORE_PATH: paths.assessments,
    } }, require: (specifier) => specifier === "node:fs/promises" ? {
      ...fs, readFile: async (...args) => {
        if (args[0] === `${paths.referrals}.transaction.json`) journalReads += 1;
        return fs.readFile(...args);
      }, rename: async (...args) => {
        if (args[1] === failure) throw new Error("Synthetic cross-file interruption");
        await beforeRename(...args);
        return fs.rename(...args);
      },
    } : require(specifier) };
    return {
      referrals: loadTypeScriptModule(root, "lib/pipeline/referral-store.ts", globals),
      get workflow() { return loadTypeScriptModule(root, "lib/pipeline/workflow-store.ts", globals); },
      assessments: loadTypeScriptModule(root, "lib/assessment/assessment-store.ts", globals),
      schema: loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts", globals),
      mutations: loadTypeScriptModule(root, "lib/persistence/local-mutation.ts", globals),
    };
  };
  const store = load();
  const { referral: created } = await store.referrals.createReferral(referralInput, "original-referral", actor);
  const { referral } = await store.referrals.patchReferral(created.id, { workflowStatus: "intake_in_progress" }, created.version, actor);
  const input = { referral_id: referral.id, assigned_assessor: actor,
    data: { ...store.schema.createEmptyAssessmentToolData(), resident_name: referral.name, assessment_notes: "Preserve this answer" } };
  return { paths, load, store, referral, input, journalReads: () => journalReads, fail: (file) => { failure = file; }, intercept: fn => { beforeRename = fn; } };
}

test("a local workflow report recovers once for its complete referral and assessment snapshot", async t => {
  const f = await fixture(t);
  const { referral: second } = await f.store.referrals.createReferral({ ...referralInput, name: "Synthetic Second" }, "second-referral", actor);
  await f.store.assessments.createAssessment(f.input, actor, "first-assessment");
  await f.store.assessments.createAssessment({ ...f.input, referral_id: second.id,
    data: { ...f.input.data, assessment_notes: "Second answer stays separate" } }, actor, "second-assessment");
  const beforeFiles = await Promise.all(Object.values(f.paths).map(file => fs.readFile(file, "utf8")));
  const beforeReads = f.journalReads();
  const contexts = await f.store.workflow.getReferralWorkflowContexts([f.referral, second]);
  assert.equal(contexts.size, 2);
  assert.equal(contexts.get(f.referral.id).assessmentData.assessment_notes, "Preserve this answer");
  assert.equal(contexts.get(second.id).assessmentData.assessment_notes, "Second answer stays separate");
  assert.equal(f.journalReads() - beforeReads, 1, "one report must not reopen the recovery journal for every record");
  assert.deepEqual(await Promise.all(Object.values(f.paths).map(file => fs.readFile(file, "utf8"))), beforeFiles);
});

test("assessment creation recovers its committed workflow after interruption and restart", async t => {
  const f = await fixture(t);
  f.fail(f.paths.referrals);
  await assert.rejects(() => f.store.assessments.createAssessment(f.input, actor, "create"), /Synthetic cross-file interruption/);
  f.fail(undefined);
  const restarted = f.load();
  const referral = await restarted.referrals.getReferral(f.referral.id);
  const saved = await restarted.assessments.createAssessment(f.input, actor, "create");
  assert.equal(referral.workflowStatus, "ready_to_schedule");
  assert.equal(saved.assessment.assessment_notes, "Preserve this answer");
  assert.equal(saved.assessment.audit_events.length, 1);
  assert.equal((await restarted.assessments.listAssessments()).total, 1);
  const before = clean(await restarted.referrals.listLocalReferralAuditEvents(referral.id));
  await restarted.assessments.createAssessment(f.input, actor, "create");
  assert.deepEqual(clean(await restarted.referrals.listLocalReferralAuditEvents(referral.id)), before);
});

test("client-name correction recovers both records after the assessment file fails", async t => {
  const f = await fixture(t);
  const { assessment } = await f.store.assessments.createAssessment(f.input, actor, "create");
  f.fail(f.paths.assessments);
  const patch = { data: { resident_name: "Synthetic Corrected" } };
  const options = { expectedVersion: assessment.version, expectedReferralName: f.referral.name, mutationId: "rename" };
  await assert.rejects(() => f.store.assessments.patchAssessment(assessment.assessment_id, patch, actor, options), /Synthetic cross-file interruption/);
  f.fail(undefined);
  const restarted = f.load();
  assert.equal((await restarted.assessments.getAssessment(assessment.assessment_id)).resident_name, "Synthetic Corrected");
  assert.equal((await restarted.referrals.getReferral(f.referral.id)).name, "Synthetic Corrected");
  const saved = await restarted.assessments.patchAssessment(assessment.assessment_id, patch, actor, options);
  assert.equal(saved.ok, true);
  assert.equal(saved.assessment.version, 2);
  assert.equal(saved.assessment.assessment_notes, "Preserve this answer");
  assert.equal(saved.assessment.audit_events.length, 2);
});

test("assignment recovers the referral and every open assessment together", async t => {
  const f = await fixture(t);
  const { assessment } = await f.store.assessments.createAssessment(f.input, actor, "first");
  const { assessment: another } = await f.store.assessments.createAssessment(f.input, actor, "second");
  const current = await f.store.referrals.getReferral(f.referral.id);
  const next = { id: "synthetic-next-owner", name: "Synthetic Next Owner" };
  f.fail(f.paths.referrals);
  await assert.rejects(() => f.store.referrals.patchReferral(current.id,
    { owner: next.name, ownerId: next.id }, current.version, actor), /Synthetic cross-file interruption/);
  f.fail(undefined);
  const restarted = f.load();
  assert.equal((await restarted.referrals.getReferral(current.id)).ownerId, next.id);
  for (const id of [assessment.assessment_id, another.assessment_id]) {
    const saved = await restarted.assessments.getAssessment(id);
    assert.equal(saved.assessor_id, next.id);
    assert.equal(saved.assessor, next.name);
    assert.equal(saved.assessment_notes, "Preserve this answer");
    assert.equal(saved.version, 2);
  }
});

test("failed recovery blocks both caches, then a later lifecycle edit remains authoritative", async t => {
  const f = await fixture(t);
  f.fail(f.paths.referrals);
  await assert.rejects(() => f.store.assessments.createAssessment(f.input, actor, "create"));
  await assert.rejects(() => f.store.assessments.listAssessments(), /Synthetic cross-file interruption/);
  await assert.rejects(() => f.store.referrals.getReferral(f.referral.id), /Synthetic cross-file interruption/);
  f.fail(undefined);
  const saved = await f.store.assessments.createAssessment(f.input, actor, "create");
  const started = await f.store.assessments.patchAssessment(saved.assessment.assessment_id,
    { mark_started: true }, actor, { expectedVersion: 1, mutationId: "start" });
  assert.equal(started.ok, true);
  const before = clean(await f.store.referrals.getReferral(f.referral.id));
  assert.equal(before.workflowStatus, "assessment_in_progress");
  await f.store.assessments.createAssessment(f.input, actor, "create");
  assert.deepEqual(clean(await f.store.referrals.getReferral(f.referral.id)), before);
});

test("concurrent readers wait for both files to finish committing", async t => {
  const f = await fixture(t);
  let entered, release;
  const paused = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  f.intercept(async (_from, to) => { if (to === f.paths.assessments) { entered(); await resume; } });
  const saving = f.store.assessments.createAssessment(f.input, actor, "create");
  await paused;
  let readCompleted = false;
  const reading = Promise.all([f.store.referrals.getReferral(f.referral.id), f.store.assessments.listAssessments()])
    .then(result => { readCompleted = true; return result; });
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(readCompleted, false);
  } finally { release(); }
  await saving;
  const [referral, assessments] = await reading;
  assert.equal(referral.workflowStatus, "ready_to_schedule");
  assert.equal(assessments.total, 1);
});

test("corrupt journals and unexpected newer file contents fail closed", async t => {
  const f = await fixture(t);
  f.fail(f.paths.referrals);
  await assert.rejects(() => f.store.assessments.createAssessment(f.input, actor, "create"));
  f.fail(undefined);
  const journalPath = `${f.paths.referrals}.transaction.json`;
  const journal = await fs.readFile(journalPath, "utf8");
  assert.equal((await fs.stat(journalPath)).mode & 0o777, 0o600);
  const before = await fs.readFile(f.paths.referrals, "utf8");
  const assessmentBefore = await fs.readFile(f.paths.assessments, "utf8");
  const parsed = JSON.parse(journal);
  const variants = ["{truncated", JSON.stringify({ version: 2, entries: [] }),
    JSON.stringify({ ...parsed, entries: parsed.entries.map(entry => ({ ...entry, after: "0".repeat(64) })) }),
    JSON.stringify({ ...parsed, entries: parsed.entries.map(entry => ({ ...entry, path: `${entry.path}.wrong` })) }),
    JSON.stringify({ ...parsed, entries: [parsed.entries[0], parsed.entries[0]] })];
  for (const variant of variants) {
    await fs.writeFile(journalPath, variant);
    await assert.rejects(() => f.load().referrals.getReferral(f.referral.id));
    assert.equal(await fs.readFile(journalPath, "utf8"), variant);
    assert.equal(await fs.readFile(f.paths.referrals, "utf8"), before);
    assert.equal(await fs.readFile(f.paths.assessments, "utf8"), assessmentBefore);
  }
  await fs.writeFile(journalPath, journal);
  const external = JSON.parse(before);
  external.referrals[0].note = "Preserve unexpected newer work";
  const newer = JSON.stringify(external);
  await fs.writeFile(f.paths.referrals, newer);
  await assert.rejects(() => f.load().assessments.listAssessments(), /outside the saved transaction/);
  assert.equal(await fs.readFile(f.paths.referrals, "utf8"), newer);
  assert.equal(await fs.readFile(journalPath, "utf8"), journal);
  // Restore only this synthetic conflict fixture to verify a controlled retry.
  await fs.writeFile(f.paths.referrals, before);
  assert.equal((await f.load().referrals.getReferral(f.referral.id)).workflowStatus, "ready_to_schedule");
  await assert.rejects(() => fs.stat(journalPath), { code: "ENOENT" });
});

test("a caught nested failure rolls back both stores without discarding earlier outer work", async t => {
  const f = await fixture(t);
  await f.store.mutations.withLocalMutation(async () => {
    await f.store.referrals.patchReferral(f.referral.id, { note: "Keep outer work" }, f.referral.version, actor);
    await assert.rejects(() => f.store.mutations.withLocalMutation(async () => {
      const current = await f.store.referrals.getReferral(f.referral.id);
      await f.store.referrals.patchReferral(current.id, { note: "Discard inner work" }, current.version, actor);
      await f.store.assessments.createAssessment(f.input, actor, "rolled-back-inner");
      throw new Error("Synthetic nested failure");
    }), /Synthetic nested failure/);
  });
  const restarted = f.load();
  assert.equal((await restarted.referrals.getReferral(f.referral.id)).note, "Keep outer work");
  assert.equal((await restarted.assessments.listAssessments()).total, 0);
  const saved = await restarted.assessments.createAssessment(f.input, actor, "rolled-back-inner");
  assert.equal(saved.ok, true);
  assert.equal(saved.assessment.audit_events.length, 1);
});

for (const phase of ["before-intent", "after-intent", "after-first-file", "after-all-files"]) {
  test(`abrupt process death ${phase} preserves a recoverable name correction`, { timeout: 30_000 }, async t => {
    const f = await fixture(t);
    const { assessment } = await f.store.assessments.createAssessment(f.input, actor, "create");
    const patch = { data: { resident_name: "Synthetic Crash Recovery" } };
    const options = { expectedVersion: assessment.version, expectedReferralName: f.referral.name, mutationId: "crash-name" };
    const childCode = `
      import * as fs from 'node:fs/promises';
      import { createRequire } from 'node:module';
      import { loadTypeScriptModule } from './scripts/ts-module-loader.mjs';
      const require = createRequire(import.meta.url), paths = ${JSON.stringify(f.paths)}, phase = ${JSON.stringify(phase)};
      const journal = paths.referrals + '.transaction.json';
      const globals = { globalThis: {}, crypto: globalThis.crypto, process: { ...process, env: { ...process.env,
        PIPELINE_DATABASE_MODE: 'disconnected', PIPELINE_REFERRAL_STORE_MODE: 'local_file', PIPELINE_ASSESSMENT_STORE_MODE: 'local_file',
        PIPELINE_REFERRAL_STORE_PATH: paths.referrals, PIPELINE_ASSESSMENT_STORE_PATH: paths.assessments,
      } }, require: specifier => specifier === 'node:fs/promises' ? { ...fs, rename: async (from, to) => {
        if (phase === 'before-intent' && to === journal) process.kill(process.pid, 'SIGKILL');
        await fs.rename(from, to);
        if ((phase === 'after-intent' && to === journal) || (phase === 'after-first-file' && to === paths.referrals)
          || (phase === 'after-all-files' && to === paths.assessments)) process.kill(process.pid, 'SIGKILL');
      } } : require(specifier) };
      const store = loadTypeScriptModule(process.cwd(), 'lib/assessment/assessment-store.ts', globals);
      await store.patchAssessment(${JSON.stringify(assessment.assessment_id)}, ${JSON.stringify(patch)}, ${JSON.stringify(actor)}, ${JSON.stringify(options)});
      process.exit(7);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    const signal = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => code === null ? resolve(signal) : reject(new Error(`${code}: ${stderr}`)));
    });
    assert.equal(signal, "SIGKILL");
    const restarted = f.load();
    const expectedName = phase === "before-intent" ? f.referral.name : patch.data.resident_name;
    assert.equal((await restarted.referrals.getReferral(f.referral.id)).name, expectedName);
    assert.equal((await restarted.assessments.getAssessment(assessment.assessment_id)).resident_name, expectedName);
    const saved = await restarted.assessments.patchAssessment(assessment.assessment_id, patch, actor, options);
    assert.equal(saved.ok, true);
    assert.equal(saved.assessment.version, 2);
    assert.equal(saved.assessment.audit_events.length, 2);
    assert.equal(saved.assessment.assessment_notes, "Preserve this answer");
    assert.equal((await fs.stat(f.paths.referrals)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(f.paths.assessments)).mode & 0o777, 0o600);
    await assert.rejects(() => fs.stat(`${f.paths.referrals}.transaction.json`), { code: "ENOENT" });
  });
}


for (const point of ["intent", "referral-file"]) {
  test(`legacy review correction is atomic through ${point} failure, restart and replay`, async t => {
    const f = await fixture(t);
    const { assessment } = await f.store.assessments.createAssessment(f.input, actor, "signed-source");
    // Seed a preserved pre-upgrade signed submission; current recommendations
    // deliberately no longer manufacture this legacy review state.
    const stored = JSON.parse(await fs.readFile(f.paths.assessments, "utf8"));
    stored.assessments[0].signed_at = "2026-11-07T00:00:00Z";
    stored.assessments[0].status = "complete";
    await fs.writeFile(f.paths.assessments, JSON.stringify(stored));
    const current = await f.store.referrals.getReferral(f.referral.id);
    const review = { reviewId: crypto.randomUUID(), assessmentId: assessment.assessment_id, assessmentVersion: 1,
      recommendationId: crypto.randomUUID(), recommendationVersion: 1, submissionNumber: 1,
      status: "submitted", notificationStatus: "pending", submittedAt: "2026-11-07T00:00:00Z",
      submittedBy: actor.id, submittedByName: actor.name, dueAt: "2026-11-10T00:00:00Z", version: 1, updatedAt: "2026-11-07T00:00:00Z" };
    const prepared = await f.store.referrals.patchReferral(current.id, { assessmentReview: review,
      assessmentReviewHistory: [review], workflowStatus: "recommendation_submitted" }, current.version, actor);
    assert.equal(prepared.ok, true);
    const before = await Promise.all([f.paths.referrals, f.paths.assessments].map(file => fs.readFile(file, "utf8")));
    const send = (store, input = { reviewId: review.reviewId, reasonNote: "Synthetic correction" }, who = actor) =>
      store.workflow.requestAssessmentReviewChanges(current.id, input, prepared.referral.version,
        prepared.referral.sectionVersions.decision, review.version, who, "review-correction");
    if (point === "intent") {
      f.intercept(async (temporary, destination) => {
        if (destination !== `${f.paths.referrals}.transaction.json`) return;
        const journal = JSON.parse(await fs.readFile(temporary, "utf8"));
        if (journal.entries.some(entry => entry.store === "referrals")) throw new Error("Synthetic cross-file interruption");
      });
    } else f.fail(f.paths.referrals);
    await assert.rejects(() => send(f.load()), /Synthetic cross-file interruption/);
    if (point === "intent") {
      assert.deepEqual(await Promise.all([f.paths.referrals, f.paths.assessments].map(file => fs.readFile(file, "utf8"))), before);
    }
    f.fail(undefined);
    f.intercept(async () => {});
    const restarted = f.load();
    const responses = await Promise.all(Array.from({ length: 6 }, () => send(restarted)));
    for (const saved of responses) assert.equal(saved.ok, true);
    const successor = responses[0].record.successorAssessmentId;
    assert.ok(successor);
    for (const saved of responses) assert.equal(saved.record.successorAssessmentId, successor);
    const assessments = await restarted.assessments.listAssessments({ referralId: current.id });
    assert.equal(assessments.total, 2);
    for (const saved of assessments.assessments) assert.equal(saved.assessment_notes, "Preserve this answer");
    assert.equal((await restarted.assessments.getAssessment(assessment.assessment_id)).signed_at, "2026-11-07T00:00:00Z");
    const audit = clean(await restarted.referrals.listLocalReferralAuditEvents(current.id));
    assert.equal(audit.filter(event => event.action === "assessment_review_changes_requested").length, 1);
    await assert.rejects(() => send(restarted, undefined, { id: "different", name: "Other account" }), { name: "MutationReplayConflictError" });
    await assert.rejects(() => send(restarted, { reviewId: review.reviewId, reasonNote: "Changed correction" }), { name: "MutationReplayConflictError" });
    assert.equal((await f.load().assessments.listAssessments({ referralId: current.id })).total, 2);
    assert.deepEqual(clean(await restarted.referrals.listLocalReferralAuditEvents(current.id)), audit);
  });
}
