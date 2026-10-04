import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { emptyStaffProfile: base, reconcileProfileDraft: merge } = loadTypeScriptModule(process.cwd(), "lib/pipeline/staff-profile.ts");
const clean = (value) => JSON.parse(JSON.stringify(value));

test("profile recovery merges untouched remote fields without losing newer typing", () => {
  const local = { ...base, preferred_name: "New typing" };
  const result = merge({ base, form: local }, { ...base, job_title: "Remote job", version: 2 });
  assert.equal(result.form.preferred_name, "New typing");
  assert.equal(result.form.job_title, "Remote job");
  assert.equal(result.conflict, false);
  assert.equal(result.base.version, 2);
});
test("a lost profile acknowledgment is read back before replaying newer typing", () => {
  const sent = { ...base, preferred_name: "First save" };
  const latest = { ...sent, version: 2 };
  const result = merge({ base, form: { ...sent, preferred_name: "Typed during save" }, sent }, latest);
  assert.equal(result.form.preferred_name, "Typed during save");
  assert.equal(result.conflict, false);
  assert.equal(result.base.version, 2);
  const acknowledged = merge({ base, form: sent, sent }, latest);
  assert.equal(acknowledged.form.preferred_name, latest.preferred_name);
});
test("same-field conflicts retain the local draft and require explicit review across reload", () => {
  const draft = { base, form: { ...base, preferred_name: "Mine" } };
  const latest = { ...base, preferred_name: "Theirs", version: 2 };
  const result = merge(draft, latest);
  assert.equal(result.conflict, true);
  assert.equal(result.form.preferred_name, "Mine");
  assert.equal(result.base.preferred_name, "Theirs");
  assert.deepEqual(clean(merge(result, latest)), clean(result));
});

test("reverting during an unacknowledged save remains an edit, including after reload", () => {
  const sent = { ...base, preferred_name: "Temporary edit" };
  const result = merge({ base, form: { ...base }, sent }, { ...sent, version: 2 });
  assert.equal(result.form.preferred_name, null);
  assert.equal(result.base.preferred_name, "Temporary edit");
  assert.equal(result.conflict, false);
  assert.deepEqual(clean(merge(result, result.base)), clean(result));
});
