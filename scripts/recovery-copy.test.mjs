import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const { assessmentSaveStatus } = loadEntry("components/pipeline/assessment-workspace-state.ts", {
  "@/lib/auth/authenticated-fetch": {},
  "@/lib/pipeline/referral-ownership": {},
  "@/lib/assessment/assessment-records": {},
  "@/lib/assessment/assessment-tool-schema": {},
});
const status = (overrides) => assessmentSaveStatus({
  error: "", trainingAssessmentMode: undefined, dirty: false, message: "",
  networkOnline: true, pendingOfflineSaves: 0, ...overrides,
});

test("restored answers are not presented as an active save", () => {
  for (const message of ["Restored answers · not yet saved", "Restored answers · review conflicting changes"]) {
    assert.equal(status({ dirty: true, message }), message);
  }
  assert.equal(status({ dirty: true, message: "Unsaved changes" }), "Changes not yet saved");
  assert.equal(status({ dirty: true, message: "" }), "Changes not yet saved");
});

test("active saves, confirmed saves, offline queues and errors retain distinct statuses", () => {
  for (const message of ["Saving changes...", "Saving last changes..."]) {
    assert.equal(status({ dirty: true, message }), message);
  }
  assert.equal(status({}), "All changes saved");
  assert.equal(status({ dirty: true, pendingOfflineSaves: 1 }), "1 change waiting to sync");
  assert.equal(status({ dirty: true, networkOnline: false, pendingOfflineSaves: 1 }), "Offline · 1 queued");
  assert.equal(status({ dirty: true, error: "Save failed" }), "Save failed");
});

test("intake recovery copy distinguishes restoring edits from saving or creating a referral", () => {
  const canvas = readFileSync("components/pipeline/ReferralPacketCanvas.tsx", "utf8");
  assert.ok(canvas.includes('aria-label="Restored edits"'));
  assert.ok(canvas.includes("These edits are back in the form, but aren't saved to the chart yet."));
  assert.ok(canvas.includes("Continue intake, then choose Create referral when you're ready."));
  assert.ok(canvas.includes("Re-select {recoveredPacketName} before uploading the packet."));
  assert.ok(canvas.includes("Discard unsaved edits"));
  assert.ok(!canvas.includes("Recovered changes from your account."));
  assert.ok(!canvas.includes("let autosave store them"));
});
