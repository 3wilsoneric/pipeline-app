import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const identity = loadTypeScriptModule(process.cwd(), "lib/pipeline/client-identity-presentation.mjs");
const { referralRoleFacts, referralOwnerResponsibilityLabels } = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-owner-identity.ts");
const { activityEventLabel, activityEventProvenance } = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-activity-presentation.ts");
// Modules run in a separate VM realm; compare plain copies.
const clean = (value) => JSON.parse(JSON.stringify(value));

test("system name placeholders become distinct unnamed referral titles without rewriting source values", () => {
  const first = { id: 2718, name: "Pending Review", community: "Turlock" };
  const second = { id: 2719, name: "Pending Review", community: "Turlock" };
  assert.equal(identity.formatClientIdentityTitle(first), "Unnamed referral · #2718");
  assert.equal(identity.formatClientIdentityTitle(second), "Unnamed referral · #2719");
  assert.equal(first.name, "Pending Review");
  for (const name of ["Pending packet review", "pending   REVIEW", "Name not recorded", "", null, undefined]) {
    assert.equal(identity.formatClientIdentityTitle({ name, referralId: 5 }), "Unnamed referral · #5", String(name));
  }
  // Its own label is stable when re-read (recent destinations re-format titles).
  assert.equal(identity.formatClientIdentityTitle({ name: "Unnamed referral · #2718", referralId: 2718 }), "Unnamed referral · #2718");
  // Without a referral ID there is no number to show, so the existing label stays.
  assert.equal(identity.formatClientIdentityTitle({ name: "Pending Review" }), "Name not recorded");
  assert.equal(identity.presentClientName("Pending Review", 31), "Unnamed referral · #31");
  // Storage normalization is unchanged, so creating from the canvas default still succeeds.
  assert.equal(identity.normalizeClientName("Pending packet review"), "Pending Review");
});

test("real names, including ones containing placeholder words, are never reclassified", () => {
  for (const [name, expected] of [["Jordan Sample", "Jordan Sample"], ["Review Pending", "Review Pending"], ["Penny Reviewer", "Penny Reviewer"]]) {
    assert.equal(identity.isSystemPlaceholderClientName(name), false, name);
    assert.equal(identity.formatClientIdentityTitle({ name, referralId: 9 }), expected);
  }
  assert.equal(identity.formatClientIdentityTitle({ name: "Jordan Sample", id: "not-a-referral-id" }), "Jordan Sample");
});

test("same-name referrals stay distinguishable; unnamed referrals get source and date context", () => {
  const context = (referral) => identity.formatReferralIdentityContext(referral);
  assert.notEqual(context({ name: "Jordan Sample", referralId: 101 }), context({ name: "Jordan Sample", referralId: 102 }));
  assert.equal(context({ name: "Jordan Sample", referralId: 101 }), "Referral #101");
  assert.equal(context({ name: "Pending Review", referralId: 2718, received: "Sep 18, 2026", source: "North County Behavioral Health" }), "Received Sep 18, 2026 · North County Behavioral Health");
  assert.equal(context({ name: "Pending Review", referralId: 2718, received: "Sep 18, 2026", source: "Referral packet" }), "Received Sep 18, 2026");
  assert.equal(context({ name: "Jordan Sample" }), "");
});

test("assigned assessor, assessment assessor, and author are separate recorded roles", () => {
  const unassignedStartedByUser = referralRoleFacts({
    owner: "Unassigned",
    assessment: { assessor: { id: "u-eric", name: "Synthetic Assessor" }, author: { id: "u-eric", name: "Synthetic Assessor" } },
  });
  assert.deepEqual(clean(unassignedStartedByUser).map(({ role, label, value }) => [role, label, value]), [
    ["assigned_assessor", "Assigned assessor", "Unassigned"],
    ["assessment_assessor", "Assessment assessor", "Synthetic Assessor"],
  ]);
  const startedBySupervisor = referralRoleFacts({
    owner: "Synthetic Assessor", ownerId: "u-a",
    assessment: { assessor: { id: "u-a", name: "Synthetic Assessor" }, author: { id: "u-s", name: "Synthetic Supervisor" } },
  });
  assert.deepEqual(clean(startedBySupervisor).map((fact) => fact.role), ["assigned_assessor", "assessment_author"]);
  // IDs identify people even when a display name was edited.
  const renamed = referralRoleFacts({ owner: "A. Sample", ownerId: "u-a", assessment: { assessor: { id: "U-A", name: "Alex Sample" }, author: { id: "u-a", name: "Alex Sample" } } });
  assert.deepEqual(clean(renamed).map((fact) => fact.role), ["assigned_assessor"]);
  assert.deepEqual(clean(referralRoleFacts({ owner: "", assessment: null })).map((fact) => fact.value), ["Unassigned"]);
  assert.equal(referralOwnerResponsibilityLabels.assignee, "Assigned assessor");
});

test("the paired assessment-creation audit rows get distinct labels and full provenance", () => {
  const onAssessment = { event_id: "aud_1", source: "audit", entity_type: "assessment", entity_id: "asm_1", action: "assessment_created", from_version: null, to_version: 1, created_at: "2026-09-18T15:04:05.123Z" };
  const onReferral = { ...onAssessment, event_id: "aud_2", entity_type: "referral", entity_id: "2718", from_version: 3, to_version: 4 };
  assert.equal(activityEventLabel(onAssessment), "Assessment created");
  assert.equal(activityEventLabel(onReferral), "Referral status updated (assessment created)");
  assert.equal(activityEventLabel({ action: "assessment_signed", entity_type: "referral" }), "Referral status updated (assessment signed)");
  assert.equal(activityEventLabel({ action: "custom_step" }), "Custom step");
  const provenance = Object.fromEntries(clean(activityEventProvenance(onReferral)).map((item) => [item.label, item.value]));
  assert.deepEqual(provenance, {
    Source: "Audit log", "Audit event": "aud_2", Record: "Referral 2718", "Action code": "assessment_created",
    Version: "3 → 4", "Recorded (UTC)": "2026-09-18T15:04:05.123Z",
  });
  const derived = Object.fromEntries(activityEventProvenance({ ...onAssessment, source: "record", event_id: "referral-5-created", entity_type: "referral", entity_id: "5" }).map((item) => [item.label, item.value]));
  assert.equal(derived.Source, "Derived from the saved record (no audit row)");
  assert.equal(derived.Entry, "referral-5-created");
});
