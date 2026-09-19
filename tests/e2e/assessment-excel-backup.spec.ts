import { expect, test, webkit } from "@playwright/test";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, signOperationalAssessment } from "./support/operational-api";
import { changeWorkbook, workbookRuntime } from "./support/workbook-runtime";
import type * as Backup from "../../lib/assessment/assessment-excel-backup";
import type * as Contract from "../../lib/assessment/assessment-workbook-contract";
import type * as Schema from "../../lib/assessment/assessment-tool-schema";
type Runtime = typeof Backup & typeof Contract & typeof Schema;
declare global { interface Window { workbookTest: Runtime } }
const templateFile = "public/templates/pipeline-assessment-workbook.xlsx";

test("every canonical field round-trips exactly, including long answers and explicit reasons", async ({ page }, info) => {
  await page.goto("/"); await workbookRuntime(page);
  const bytes = Array.from(await fs.readFile(templateFile));
  const result = await page.evaluate(async (template) => {
    const w = window.workbookTest, data = w.createEmptyAssessmentToolData();
    for (const field of w.assessmentWorkbookFields) {
      const option = field.question?.options?.[0]?.value;
      let value: unknown = option ?? `Synthetic ${field.key} = < & >`;
      if (field.value_type === "integer") value = field.question?.min ?? 0;
      if (field.value_type === "confidence") value = 0.75;
      if (field.value_type === "date") value = "2026-09-19";
      if (field.value_type === "timestamp") value = "2026-09-19T14:00:00.000Z";
      if (field.value_type === "string_list") value = option ? [option] : ["Synthetic one", "Synthetic two\nembedded newline"];
      if (field.value_type === "reason_map") value = { medication_adherence: "Synthetic explanation" };
      data[field.key] = value as never;
    }
    data.medication_adherence = "unable_to_assess";
    data.assessment_notes = "N".repeat(50000);
    data.medications_at_intake = Array.from({ length: 200 }, (_, i) => `${i}:` + "M".repeat(1900));
    const id = { assessmentId: "synthetic_roundtrip", referralId: 7, origin: location.origin };
    const exported = await w.exportAssessmentWorkbook(new Uint8Array(template), id, data);
    const started = performance.now();
    const imported = await w.importAssessmentWorkbook(exported.bytes, id);
    const importMs = performance.now() - started;
    const mismatches = w.assessmentToolFieldDefinitions.filter((d) => JSON.stringify(imported.answers[d.key]) !== JSON.stringify(data[d.key])).map((d) => d.key);
    const again = await w.exportAssessmentWorkbook(new Uint8Array(template), id, imported.answers);
    const second = await w.importAssessmentWorkbook(again.bytes, id);
    return { mismatches, count: w.assessmentToolFieldDefinitions.length, importMs, changes: w.assessmentWorkbookChanges(second, data), bytes: Array.from(exported.bytes) };
  }, bytes);
  expect(result.mismatches).toEqual([]); expect(result.changes).toEqual([]); expect(result.count).toBeGreaterThan(159);
  expect(result.importMs).toBeLessThan(2000);
  await info.attach("local-import-timing", { body: `${result.importMs.toFixed(1)} ms for all fields, including long notes/lists`, contentType: "text/plain" });
  await fs.writeFile(info.outputPath("synthetic-long-roundtrip.xlsx"), Buffer.from(result.bytes));
});

test("workbook parsing refuses wrong identity, changed mapping, formulas, old schemas and corrupt files", async ({ page }) => {
  await page.goto("/"); await workbookRuntime(page);
  const template = Array.from(await fs.readFile(templateFile));
  const exported = await page.evaluate(async (template) => {
    const w = window.workbookTest;
    return Array.from((await w.exportAssessmentWorkbook(new Uint8Array(template), { assessmentId: "synthetic", referralId: 8, origin: location.origin }, w.createEmptyAssessmentToolData())).bytes);
  }, template);
  const variants = [
    Buffer.from("not excel"),
    changeWorkbook(new Uint8Array(exported), [{ sheet: 14, cell: "B2", value: "old-schema" }]),
    changeWorkbook(new Uint8Array(exported), [{ sheet: 2, cell: "A6", value: "wrong_field" }]),
    changeWorkbook(new Uint8Array(exported), [{ sheet: 2, cell: "C6", value: "2", formula: true }]),
    zipSync({ ...unzipSync(new Uint8Array(exported)), "xl/vbaProject.bin": strToU8("rejected") }),
    zipSync({ "oversized.xml": new Uint8Array(25 * 1024 * 1024) }),
  ];
  for (const value of variants) {
    const failed = await page.evaluate(async (bytes) => { try { await window.workbookTest.importAssessmentWorkbook(new Uint8Array(bytes), { assessmentId: "synthetic", referralId: 8, origin: location.origin }); return false; } catch { return true; } }, Array.from(value));
    expect(failed).toBe(true);
  }
  const wrongClient = await page.evaluate(async (bytes) => { try { await window.workbookTest.importAssessmentWorkbook(new Uint8Array(bytes), { assessmentId: "other", referralId: 8, origin: location.origin }); return ""; } catch (e) { return String(e); } }, exported);
  expect(wrongClient).toContain("different assessment");
});

test("download current unsynced answers, drop Excel changes, review conflicts and sync offline edits", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Excel", owner: "", tags: [] });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { prior_placements: "Synthetic baseline", prior_hospitalizations_count: 0, prior_5150_5250_holds: "Synthetic history" } } });
  expect(created.status(), await created.text()).toBe(201);
  const { assessment } = await created.json();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await expect(page.locator("[data-phone-interview]")).toBeVisible();
  await page.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true }).fill("Latest device answer");
  await page.context().setOffline(true);
  await page.locator('summary[aria-label="Assessment details"]').click();
  await page.getByRole("button", { name: "Excel backup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Excel backup", exact: true });
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const download = await downloadEvent;
  const original = await fs.readFile((await download.path())!);
  await workbookRuntime(page);
  const parsed = await page.evaluate(async ({ bytes, assessmentId, referralId }) => {
    const copy = await window.workbookTest.importAssessmentWorkbook(new Uint8Array(bytes), { assessmentId, referralId, origin: location.origin });
    return { answer: copy.answers.prior_awol_failed_placements, elapsed: performance.now() };
  }, { bytes: Array.from(original), assessmentId: assessment.assessment_id, referralId: referral.id });
  expect(parsed.answer).toBe("Latest device answer");
  // History is sheet 4; AWOL is C7, crisis utilization is C11.
  const changed = changeWorkbook(original, [{ sheet: 4, cell: "C7", value: "Excel updated answer" }, { sheet: 4, cell: "C11", value: "Synthetic crisis detail" }]);
  const transfer = await page.evaluateHandle((bytes) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], "assessment.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); return dt; }, Array.from(changed));
  await dialog.getByRole("region", { name: "Restore Excel workbook", exact: true }).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dialog.getByRole("heading", { name: "2 changed answers" })).toBeVisible();
  await dialog.getByRole("button", { name: "Apply 2 answers", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Answers restored");
  await page.screenshot({ path: info.outputPath("mobile-excel-backup.png") });
  await dialog.getByRole("button", { name: "Close Excel backup", exact: true }).click();
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText(/Offline|queued/i);
  await page.context().setOffline(false);
  await expect.poll(async () => (await read()).prior_awol_failed_placements, { timeout: 15000 }).toBe("Excel updated answer");
  await expect.poll(async () => (await read()).crisis_er_utilization).toBe("Synthetic crisis detail");
  expect((await read()).field_provenance.crisis_er_utilization.at(-1).source_field_key).toBe("workbook.crisis_er_utilization");
  expect((await read()).signed_at).toBeNull();
  await page.locator('summary[aria-label="Assessment details"]').click();
  await page.getByRole("button", { name: "Excel backup", exact: true }).click();
  await dialog.getByLabel("Choose workbook").setInputFiles({ name: "assessment.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: original });
  await expect(dialog.getByRole("heading", { name: "No new changes", exact: true })).toBeVisible();
  const conflicting = changeWorkbook(original, [{ sheet: 4, cell: "C7", value: "Older copy different answer" }, { sheet: 4, cell: "C6", value: "" }]);
  await dialog.getByLabel("Choose workbook").setInputFiles({ name: "assessment.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: conflicting });
  await expect(dialog.getByRole("button", { name: "Apply 0 answers", exact: true })).toBeDisabled();
  await dialog.getByLabel("Use the workbook answer", { exact: true }).check();
  await dialog.getByRole("button", { name: "Apply 1 answer", exact: true }).click();
  await expect.poll(async () => (await read()).prior_awol_failed_placements).toBe("Older copy different answer");
  expect((await read()).prior_placements).toBe("Synthetic baseline");
});

test("offline workbook restore never overwrites a concurrent server answer", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic concurrent Excel", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await page.locator('summary[aria-label="Assessment details"]').click();
  await page.getByRole("button", { name: "Excel backup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Excel backup", exact: true });
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const bytes = await fs.readFile((await (await downloading).path())!);
  const changed = changeWorkbook(bytes, [{ sheet: 4, cell: "C7", value: "Offline Excel answer" }]);
  await page.context().setOffline(true);
  await dialog.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
  await dialog.getByRole("button", { name: "Apply 1 answer", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Answers restored");
  const remote = await page.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: { prior_awol_failed_placements: "Another assessor's answer" } } } });
  expect(remote.status(), await remote.text()).toBe(200);
  await dialog.getByRole("button", { name: "Close Excel backup", exact: true }).click();
  await page.context().setOffline(false);
  await expect(page.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_awol_failed_placements).toBe("Another assessor's answer");
  await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Offline Excel answer");
  await page.getByRole("button", { name: "Use latest", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Another assessor's answer");
});

test("restore API validates fields, records provenance, and cannot sign or edit signed assessments", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Excel validation", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/api/assessments/${assessment.assessment_id}`;
  const source = { export_id: randomUUID(), exported_at: new Date().toISOString() };
  for (const patch of [
    { data: { assessor: "Changed owner" }, workbook_restore: source },
    { data: { unknown_answer: "Injected" }, workbook_restore: source },
    { data: { prior_hospitalizations_count: -1 }, workbook_restore: source },
    { data: { prior_placements: "Answer" }, status: "signed", workbook_restore: source },
    { data: { prior_placements: "Answer" }, workbook_restore: { ...source, export_id: "broken" } },
  ]) {
    const response = await page.request.patch(url, { data: { if_match: assessment.version, patch } });
    expect(response.status(), await response.text()).toBe(400);
  }
  const response = await page.request.patch(url, { data: { if_match: assessment.version, patch: { data: { prior_hospitalizations_count: 0 }, workbook_restore: source } } });
  expect(response.status(), await response.text()).toBe(200);
  const restored = (await response.json()).assessment;
  expect(restored.prior_hospitalizations_count).toBe(0);
  expect(restored.signed_at).toBeNull();
  expect(restored.field_provenance.prior_hospitalizations_count.at(-1)).toMatchObject({ source_field_key: "workbook.prior_hospitalizations_count", source_file: `Excel backup ${source.export_id}` });
  const completed = await completeOperationalAssessment(page.request, restored);
  const signed = await signOperationalAssessment(page.request, completed);
  const denied = await page.request.patch(url, { data: { if_match: signed.version, patch: { data: { prior_placements: "Must not replace signed answer" }, workbook_restore: source } } });
  expect(denied.status(), await denied.text()).toBe(400);
  expect(await denied.text()).toContain("signed assessment");
});

test("iPad WebKit exports and restores Excel with usable tablet and phone controls", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Tablet Excel", owner: "", tags: [] });
    const assessment = await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
    await page.locator('summary[aria-label="Assessment details"]').tap();
    await page.getByRole("button", { name: "Excel backup", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Excel backup", exact: true });
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download current assessment", exact: true }).tap();
    const bytes = await fs.readFile((await (await downloading).path())!);
    const changed = changeWorkbook(bytes, [{ sheet: 4, cell: "C7", value: "Synthetic tablet update" }]);
    await dialog.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
    await expect(dialog.getByRole("button", { name: "Apply 1 answer", exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("webkit-excel-restore.png") });
    await dialog.getByRole("button", { name: "Apply 1 answer", exact: true }).tap();
    await expect(dialog.getByRole("status")).toContainText("Answers restored");
    expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_awol_failed_placements).toBe("Synthetic tablet update");
    await dialog.getByRole("button", { name: "Close Excel backup", exact: true }).tap();
    await expect(page.locator('summary[aria-label="Assessment details"]')).toBeFocused();
  } finally { await browser.close(); }
});
