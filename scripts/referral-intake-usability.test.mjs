import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const dates = loadTypeScriptModule(root, "lib/pipeline/calendar-date.ts");
const persistence = loadTypeScriptModule(root, "lib/pipeline/referral-canvas-persistence.ts");
const extraction = loadTypeScriptModule(root, "lib/pipeline/referral-canvas-extraction.ts");
const validation = loadTypeScriptModule(root, "lib/pipeline/referral-validation.ts");
const fields = () => Object.fromEntries(persistence.persistedCanvasFieldKeys.map((key) => [key, { label: key, value: "" }]));
const create = (canvas) => persistence.buildReferralCanvasCreateInput({ fields: canvas, conserved: "", community: "Unassigned", tags: [], requirements: [], createdAt: "2026-09-13T12:00:00.000Z" });

test("age follows birthday, accepts imported local dates and rejects invalid/future DOB", () => {
  for (const [dob, today, expected] of [
    ["1980-09-13", "2026-09-12", 45], ["1980-09-13", "2026-09-13", 46],
    ["9/13/1980", "2026-09-14", 46], ["2026-09-13", "2026-09-13", 0],
    ["2000-02-29", "2025-02-28", 24], ["2000-02-29", "2025-03-01", 25],
    ["2026-09-14", "2026-09-13", null], ["2025-02-29", "2026-09-13", null],
    ["", "2026-09-13", null], ["1980-09-13", "invalid", null],
  ]) assert.equal(dates.ageFromCalendarDate(dob, today), expected, `${dob} as of ${today}`);
  assert.equal(dates.calendarToday(new Date(2026, 0, 2, 0, 1)), "2026-01-02");
});

test("recovered intake cannot create an admitted client, and source-reported age is preserved", () => {
  const canvas = fields();
  canvas.name.value = "Synthetic intake fixture";
  canvas.dob.value = "1980-09-13";
  canvas.age = { label: "AGE", value: "44", sourceFile: "source.pdf" };
  canvas.admissionDate = { label: "Admission date", value: "2026-09-01", sourceFile: "requested.pdf" };
  const created = create(canvas);
  assert.equal(created.admissionDate, "");
  assert.equal(created.reportedAge, "44");
  assert.equal(created.fieldSources.age, "source.pdf");
  assert.equal(created.fieldSources.admissionDate, undefined);
  assert.equal(validation.validateReferralCreateInput(created).ok, true);
  assert.equal(validation.validateReferralCreateInput({ ...created, admissionDate: "2026-09-01" }).ok, false);
  assert.equal(validation.validateReferralCreateInput({ ...created, dob: "9999-01-01" }).ok, false);
  assert.equal(validation.validateReferralPatch({ dob: "1980-09-13" }).ok, true);
  assert.equal(validation.validateReferralPatch({ dob: "9999-01-01" }).ok, false);
});

test("intake edits neither set nor clear existing actual admissions or their evidence", () => {
  const canvas = fields();
  canvas.name.value = "Corrected synthetic name";
  canvas.admissionDate = { label: "Admission date", value: "2026-09-01", sourceFile: "admission.pdf" };
  const patch = persistence.buildReferralCanvasPatch({ keys: new Set(["name", "admissionDate"]), fields: canvas, conserved: "", tags: [], requirements: [], existingFieldSources: { admissionDate: "original-admission.pdf" } });
  assert.equal(patch.name, "Corrected synthetic name");
  assert.equal(Object.hasOwn(patch, "admissionDate"), false);
  assert.equal(patch.fieldSources.admissionDate, "original-admission.pdf");
  assert.equal(persistence.referralCanvasValue({ admissionDate: "2026-08-01" }, "admissionDate"), "2026-08-01");
});

test("requested admission remains packet evidence, never actual admission data", () => {
  const canvas = fields();
  const packet = [{ field_key: "referral.preferred_admission_date", value: "2026-09-20", review_status: "accepted" }];
  assert.equal(extraction.extractedCanvasFieldKeys(packet[0].field_key).length, 0);
  const populated = extraction.populateFormFromExtraction(canvas, packet, "packet.pdf");
  assert.equal(populated.admissionDate.value, "");
  assert.equal(packet[0].value, "2026-09-20");
});
