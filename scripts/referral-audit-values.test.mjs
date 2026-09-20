import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { referralAuditValues, isSensitiveReferralActivityField } = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-activity-presentation.ts");
const clean = (value) => JSON.parse(JSON.stringify(value));

test("audit values retain selected fields, null missing values, and mask sensitive values", () => {
  const fields = ["stage", "name", "ssn", "note", "missing"];
  const referral = { stage: "New", name: "Synthetic", ssn: "synthetic-secret", note: "Synthetic note", untouched: "excluded" };
  const actual = clean(referralAuditValues(referral, fields));
  assert.deepEqual(Object.keys(actual), fields);
  for (const key of fields) assert.equal(actual[key], isSensitiveReferralActivityField(key) ? "[masked]" : referral[key] ?? null);
  assert.equal(actual.ssn, "[masked]");
  assert.equal(referral.ssn, "synthetic-secret");
});

test("audit output is detached from mutable nested referral data", () => {
  const referral = { requirements: [{ status: "open" }] };
  const actual = clean(referralAuditValues(referral, ["requirements"]));
  referral.requirements[0].status = "complete";
  assert.equal(actual.requirements[0].status, "open");
});
