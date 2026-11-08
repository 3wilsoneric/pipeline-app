import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { clean, loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const schema = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const actor = { id: "synthetic-recovery-assessor", name: "Synthetic Assessor" };
const input = (name = "Synthetic Recovery") => ({ referral_id: 1, data: { ...schema.createEmptyAssessmentToolData(), resident_name: name } });

async function fixture(t, overrides = {}, referralOverrides = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "pipeline-assessment-recovery-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "assessments.json");
  const load = () => {
    const globals = { globalThis: {}, process: { ...process, env: { ...process.env,
      PIPELINE_ASSESSMENT_STORE_MODE: "local_file", PIPELINE_ASSESSMENT_STORE_PATH: filename,
      PIPELINE_REFERRAL_STORE_PATH: path.join(directory, "referrals.json"),
    } } };
    const localMutation = loadEntry("lib/persistence/local-mutation.ts", {
      "node:fs/promises": { ...fs, ...overrides },
    }, globals);
    return loadEntry("lib/assessment/assessment-store.ts", {
      "node:fs/promises": { ...fs, ...overrides },
      "@/lib/persistence/local-mutation": localMutation,
      "@/lib/pipeline/referral-store": {
        getReferral: async () => ({ id: 1, version: 1, workflowStatus: "intake_in_progress", sectionVersions: { workflow: 1 } }),
        patchReferral: async () => ({ ok: true }),
        ...referralOverrides,
      },
    }, globals);
  };
  return { filename, load };
}

test("a corrupt local assessment file fails closed and can be recovered without replacing its bytes", async (t) => {
  const f = await fixture(t);
  const corrupt = '{"version":1,"assessments": [truncated synthetic fixture';
  await fs.writeFile(f.filename, corrupt);
  const store = f.load();
  await assert.rejects(() => store.createAssessment(input(), actor, "cannot-overwrite"));
  assert.equal(await fs.readFile(f.filename, "utf8"), corrupt);
  await fs.writeFile(f.filename, JSON.stringify({ version: 1, revision: 0, assessments: [] }));
  const saved = await store.createAssessment(input(), actor, "can-recover");
  assert.equal(saved.ok, true);
  assert.equal((await f.load().getAssessment(saved.assessment.assessment_id)).resident_name, "Synthetic Recovery");
});

test("unsupported store shapes and invalid records cannot be silently filtered out by a write", async (t) => {
  const f = await fixture(t);
  for (const saved of [
    { version: 2, assessments: [] },
    { version: 1, assessments: {} },
    { version: 1, assessments: [{ assessment_id: "damaged-record", referral_id: 1 }] },
  ]) {
    const bytes = JSON.stringify(saved);
    await fs.writeFile(f.filename, bytes);
    await assert.rejects(() => f.load().createAssessment(input(), actor, "cannot-filter"), /assessment store is invalid/);
    assert.equal(await fs.readFile(f.filename, "utf8"), bytes);
  }
});

test("a failed answer write never becomes a false retry acknowledgement or replaces saved answers", async (t) => {
  let failRename = false;
  const f = await fixture(t, { rename: (...args) => failRename ? Promise.reject(new Error("Synthetic rename failure")) : fs.rename(...args) });
  const store = f.load();
  const { assessment } = await store.createAssessment(input(), actor, "create-for-patch");
  const before = await fs.readFile(f.filename, "utf8");
  const options = { expectedVersion: assessment.version, mutationId: "answer-write" };
  failRename = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(() => store.patchAssessment(assessment.assessment_id, { data: { current_symptoms: "Unsaved answer" } }, actor, options), /Synthetic rename failure/);
    assert.equal((await store.getAssessment(assessment.assessment_id)).current_symptoms, null);
    assert.equal(await fs.readFile(f.filename, "utf8"), before);
  }
  failRename = false;
  const saved = await store.patchAssessment(assessment.assessment_id, { data: { current_symptoms: "Recovered answer" } }, actor, options);
  assert.equal(saved.ok, true);
  assert.equal(saved.assessment.version, assessment.version + 1);
  assert.deepEqual(clean(await f.load().getAssessment(assessment.assessment_id)), clean(saved.assessment));
});

test("a referral projection failure before commit cancels the whole assessment mutation", async (t) => {
  const f = await fixture(t, {}, { patchReferral: async () => { throw new Error("Synthetic referral projection failure"); } });
  const store = f.load();
  await assert.rejects(() => store.createAssessment(input(), actor, "uncommitted"), /Synthetic referral projection failure/);
  await assert.rejects(() => fs.readFile(f.filename, "utf8"), { code: "ENOENT" });
  assert.equal((await store.listAssessments()).total, 0);
  assert.equal((await f.load().listAssessments()).total, 0);
});

test("a transient read failure does not erase pre-existing assessments or permanently initialize an empty store", async (t) => {
  let failRead = false;
  const f = await fixture(t, { readFile: (...args) => failRead ? Promise.reject(Object.assign(new Error("Synthetic access failure"), { code: "EACCES" })) : fs.readFile(...args) });
  const saved = await f.load().createAssessment(input(), actor, "existing");
  const original = clean(await f.load().getAssessment(saved.assessment.assessment_id));
  const before = await fs.readFile(f.filename, "utf8");
  failRead = true;
  const restarted = f.load();
  await assert.rejects(() => restarted.createAssessment(input("Must not overwrite"), actor, "second"));
  assert.equal(await fs.readFile(f.filename, "utf8"), before);
  failRead = false;
  assert.deepEqual(clean(await restarted.getAssessment(saved.assessment.assessment_id)), original);
});

test("failed persistence cannot be replayed as saved and a recovered retry preserves the original assessment", async (t) => {
  let failWrite = false;
  const f = await fixture(t, { writeFile: (...args) => failWrite ? Promise.reject(new Error("Synthetic disk failure")) : fs.writeFile(...args) });
  const store = f.load();
  const saved = await store.createAssessment(input(), actor, "original");
  const original = clean(await f.load().getAssessment(saved.assessment.assessment_id));
  const before = await fs.readFile(f.filename, "utf8");
  failWrite = true;
  await assert.rejects(() => store.createAssessment(input("Unsaved"), actor, "failed-command"));
  await assert.rejects(() => store.createAssessment(input("Unsaved"), actor, "failed-command"));
  assert.equal(await fs.readFile(f.filename, "utf8"), before);
  failWrite = false;
  const recovered = await store.createAssessment(input("Recovered"), actor, "failed-command");
  assert.equal(recovered.assessment.resident_name, "Recovered");
  const reopened = f.load();
  assert.deepEqual(clean(await reopened.getAssessment(original.assessment_id)), original);
  assert.equal((await reopened.getAssessment(recovered.assessment.assessment_id)).resident_name, "Recovered");
});
