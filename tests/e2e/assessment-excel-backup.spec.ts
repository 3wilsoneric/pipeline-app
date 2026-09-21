import { expect, test, webkit } from "@playwright/test";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, signOperationalAssessment, startOperationalAssessment } from "./support/operational-api";
import { changeWorkbook, closeRecoveryTools, openRecoveryTools, workbookRuntime } from "./support/workbook-runtime";
import type * as Backup from "../../lib/assessment/assessment-excel-backup";
import type * as Contract from "../../lib/assessment/assessment-workbook-contract";
import type * as Schema from "../../lib/assessment/assessment-tool-schema";
import { assessmentWorkbookFields, assessmentWorkbookLayout } from "../../lib/assessment/assessment-workbook-contract";
import { getAssessmentCompletionSummary } from "../../lib/assessment/assessment-completion";
type Runtime = typeof Backup & typeof Contract & typeof Schema;
declare global { interface Window { workbookTest: Runtime } }
const templateFile = "public/templates/pipeline-assessment-workbook.xlsx";
const historySheet = assessmentWorkbookLayout.findIndex((section) => section.key === "prior_history") + 2;

test("conditional workbook restore labels retained details and drops inactive nested requirements without erasing answers", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic branch review", owner: "", tags: [] });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {
    arrest_history: "yes", arrest_in_last_two_years: "yes", arrest_last_two_years_details: "Synthetic earlier recorded detail",
  } } });
  expect(created.status(), await created.text()).toBe(201);
  const { assessment } = await created.json();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=legal_conservatorship`);
  await openRecoveryTools(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const original = await fs.readFile((await (await downloading).path())!);
  const field = assessmentWorkbookFields.find((item) => item.key === "arrest_history")!;
  const changed = changeWorkbook(original, [{ sheet: assessmentWorkbookLayout.findIndex((s) => s.sheet === field.sheet) + 2, cell: `C${field.row}`, value: "No" }]);
  await page.getByLabel("Choose workbook").setInputFiles({ name: "conditional-working-copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  const preview = dialog.getByRole("region", { name: "Populated assessment preview" });
  await expect(preview.getByText("Recent arrest details (previous answer)", { exact: true })).toBeVisible();
  await expect(preview).toContainText("Not applicable to the current answers. Retained for review.");
  expect((await read()).arrest_history).toBe("yes");
  await dialog.getByRole("button", { name: "Commit 1 change", exact: true }).click();
  await expect.poll(async () => (await read()).arrest_history).toBe("no");
  const saved = await read();
  expect(saved.arrest_last_two_years_details).toBe("Synthetic earlier recorded detail");
  expect(getAssessmentCompletionSummary(saved).missing.flatMap((item) => item.fields)).not.toContain("arrest_last_two_years_details");
  await page.reload();
  await openRecoveryTools(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const finalBytes = await fs.readFile((await (await downloaded).path())!);
  await workbookRuntime(page);
  const result = await page.evaluate(async ({ bytes, assessmentId, referralId }) => {
    const w = window.workbookTest;
    const copy = await w.importAssessmentWorkbook(new Uint8Array(bytes), { assessmentId, referralId, origin: location.origin });
    const archive = w.openAssessmentWorkbook(new Uint8Array(bytes));
    const field = w.assessmentWorkbookFields.find((f) => f.key === "arrest_last_two_years_details")!;
    const index = w.assessmentWorkbookLayout.findIndex((s) => s.sheet === field.sheet) + 2;
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(archive[`xl/worksheets/sheet${index}.xml`]), "application/xml");
    const status = Array.from(xml.getElementsByTagNameNS("*", "c")).find((cell) => cell.getAttribute("r") === `E${field.row}`);
    return { parent: copy.answers.arrest_history, detail: copy.answers.arrest_last_two_years_details, check: status?.getElementsByTagNameNS("*", "v")[0]?.textContent };
  }, { bytes: Array.from(finalBytes), assessmentId: assessment.assessment_id, referralId: referral.id });
  expect(result).toEqual({ parent: "no", detail: "Synthetic earlier recorded detail", check: "Review previous answer" });
});

test("every canonical field round-trips exactly, including long answers and explicit reasons", async ({ page }, info) => {
  await page.goto("/"); await workbookRuntime(page);
  const bytes = Array.from(await fs.readFile(templateFile));
  const result = await page.evaluate(async (template) => {
    const w = window.workbookTest, data = w.createEmptyAssessmentToolData();
    const syntheticValue = (field: typeof w.assessmentWorkbookFields[number]) => {
      const option = field.question?.options?.[0]?.value;
      let value: unknown = option ?? `Synthetic ${field.key} = < & >`;
      if (field.value_type === "integer") value = field.question?.min ?? 0;
      if (field.value_type === "confidence") value = 0.75;
      if (field.value_type === "date") value = "2026-09-19";
      if (field.value_type === "timestamp") value = "2026-09-19T14:00:00.000Z";
      if (field.value_type === "string_list") value = option ? [option] : ["Synthetic one", "Synthetic two\nembedded newline"];
      if (field.value_type === "reason_map") value = { medication_adherence: "Synthetic explanation" };
      return value;
    };
    for (const field of w.assessmentWorkbookFields) data[field.key] = syntheticValue(field) as never;
    data.medication_adherence = "unable_to_assess";
    data.unable_to_assess_reasons.medication_adherence = "Synthetic explanation: client requested a break; verify with the source record. ".repeat(3).trim();
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
    const reasonField = w.assessmentWorkbookFields.find((field) => field.key === "medication_adherence")!;
    const sheetIndex = w.assessmentWorkbookLayout.findIndex((section) => section.sheet === reasonField.sheet) + 2;
    const archive = w.openAssessmentWorkbook(exported.bytes);
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(archive[`xl/worksheets/sheet${sheetIndex}.xml`]), "application/xml");
    const reasonRow = Array.from(xml.getElementsByTagNameNS("*", "row")).find((row) => row.getAttribute("r") === String(reasonField.row));
    return { mismatches, count: w.assessmentToolFieldDefinitions.length, importMs, changes: w.assessmentWorkbookChanges(second, data), reasonHeight: Number(reasonRow?.getAttribute("ht")), bytes: Array.from(exported.bytes) };
  }, bytes);
  expect(result.mismatches).toEqual([]); expect(result.changes).toEqual([]); expect(result.count).toBeGreaterThan(159);
  expect(result.importMs).toBeLessThan(2000);
  expect(result.reasonHeight).toBeGreaterThan(150);
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
  await startOperationalAssessment(page.request, assessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await expect(page.locator("[data-phone-interview]")).toBeVisible();
  await page.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true }).fill("Latest device answer");
  await page.context().setOffline(true);
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  await openRecoveryTools(page);
  await expect(page.getByRole("region", { name: "Restore Excel workbook", exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const download = await downloadEvent;
  const original = await fs.readFile((await download.path())!);
  await workbookRuntime(page);
  const parsed = await page.evaluate(async ({ bytes, assessmentId, referralId }) => {
    const copy = await window.workbookTest.importAssessmentWorkbook(new Uint8Array(bytes), { assessmentId, referralId, origin: location.origin });
    return { answer: copy.answers.prior_awol_failed_placements, elapsed: performance.now() };
  }, { bytes: Array.from(original), assessmentId: assessment.assessment_id, referralId: referral.id });
  expect(parsed.answer).toBe("Latest device answer");
  const changed = changeWorkbook(original, [{ sheet: historySheet, cell: "C7", value: "Excel updated answer" }, { sheet: historySheet, cell: "C11", value: "Synthetic crisis detail" }]);
  const transfer = await page.evaluateHandle((bytes) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], "assessment.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); return dt; }, Array.from(changed));
  await page.getByRole("region", { name: "Restore Excel workbook", exact: true }).dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dialog.getByRole("heading", { name: "2 proposed changes" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Populated assessment preview" })).toContainText("Excel updated answer");
  await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("mobile-excel-backup.png") });
  await dialog.getByRole("button", { name: "Commit 2 changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-excel-strip] [role="status"]')).toContainText("2 workbook changes applied");
  await closeRecoveryTools(page);
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText(/Offline|queued/i);
  await page.context().setOffline(false);
  await expect.poll(async () => (await read()).prior_awol_failed_placements, { timeout: 15000 }).toBe("Excel updated answer");
  await expect.poll(async () => (await read()).crisis_er_utilization).toBe("Synthetic crisis detail");
  expect((await read()).field_provenance.crisis_er_utilization.at(-1).source_field_key).toBe("workbook.crisis_er_utilization");
  expect((await read()).signed_at).toBeNull();
  await openRecoveryTools(page);
  await page.getByLabel("Choose workbook").setInputFiles({ name: "assessment.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: original });
  await expect(dialog.getByRole("heading", { name: "No new changes", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const conflicting = changeWorkbook(original, [{ sheet: historySheet, cell: "C7", value: "Older copy different answer" }, { sheet: historySheet, cell: "C6", value: "" }]);
  await page.getByLabel("Choose workbook").setInputFiles({ name: "assessment.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: conflicting });
  await expect(dialog.getByRole("button", { name: "Commit changes", exact: true })).toBeDisabled();
  await dialog.getByLabel("Use workbook answer for Prior AWOL / failed placements", { exact: true }).check();
  await dialog.getByRole("button", { name: "Commit 1 change", exact: true }).click();
  await expect.poll(async () => (await read()).prior_awol_failed_placements).toBe("Older copy different answer");
  expect((await read()).prior_placements).toBe("Synthetic baseline");
});

test("offline workbook restore never overwrites a concurrent server answer", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic concurrent Excel", owner: "", tags: [] });
  const assessment = await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await openRecoveryTools(page);
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const bytes = await fs.readFile((await (await downloading).path())!);
  const changed = changeWorkbook(bytes, [{ sheet: historySheet, cell: "C7", value: "Offline Excel answer" }]);
  await page.context().setOffline(true);
  await page.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
  await dialog.getByRole("button", { name: "Commit 1 change", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const remote = await page.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: { if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: { prior_awol_failed_placements: "Another assessor's answer" } } } });
  expect(remote.status(), await remote.text()).toBe(200);
  await closeRecoveryTools(page);
  await page.context().setOffline(false);
  await expect(page.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_awol_failed_placements).toBe("Another assessor's answer");
  await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Offline Excel answer");
  await page.getByRole("button", { name: "Use latest", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Another assessor's answer");
});

test("drop previews the populated chart, cancel is neutral, and commit replaces only selected answers", async ({ page }, info) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Morgan Example", owner: "", tags: [] });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {
    prior_placements: "Supported living in a small residential community.",
    prior_awol_failed_placements: "No documented unplanned departures.",
    crisis_er_utilization: "No emergency visits in the past six months.",
    current_location: "Referral received from the community care team.",
  } } });
  expect(created.status(), await created.text()).toBe(201);
  const { assessment } = await created.json();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await openRecoveryTools(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  const bytes = await fs.readFile((await (await downloading).path())!);
  const before = await read();
  const changed = changeWorkbook(bytes, [
    { sheet: historySheet, cell: "C7", value: "One unplanned departure in 2024; returned the same day." },
    { sheet: historySheet, cell: "C6", value: "" },
    { sheet: historySheet, cell: "C11", value: "One emergency visit in June; follow-up completed." },
  ]);
  const transfer = await page.evaluateHandle((bytes) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], "working-copy.xlsx")); return dt; }, Array.from(changed));
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  const preview = dialog.getByRole("region", { name: "Populated assessment preview" });
  const awol = dialog.getByLabel("Use workbook answer for Prior AWOL / failed placements", { exact: true });
  const clearing = dialog.getByLabel("Use workbook answer for Prior placements", { exact: true });
  await page.locator("[data-excel-strip]").dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dialog.getByRole("heading", { name: "3 proposed changes" })).toBeVisible();
  await expect(preview).toContainText("Referral received from the community care team.");
  await expect(preview).toContainText("One unplanned departure in 2024");
  await expect(preview).toContainText("Supported living in a small residential community.");
  await expect(clearing).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Commit 2 changes", exact: true })).toBeEnabled();
  await expect(dialog).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("desktop-populated-preview.png") });
  await awol.uncheck();
  await expect(preview).not.toContainText("One unplanned departure in 2024");
  await expect(preview).toContainText("No documented unplanned departures.");
  expect(await read()).toEqual(before);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import workbook", exact: true })).toBeFocused();
  expect(await read()).toEqual(before);
  await page.getByLabel("Choose workbook").setInputFiles({ name: "working-copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
  await awol.uncheck();
  await clearing.check();
  await expect(preview).not.toContainText("Supported living in a small residential community.");
  await dialog.getByRole("button", { name: "Commit 2 changes", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await read()).crisis_er_utilization).toBe("One emergency visit in June; follow-up completed.");
  const saved = await read();
  expect(saved.prior_placements).toBeNull();
  expect(saved.prior_awol_failed_placements).toBe(before.prior_awol_failed_placements);
  expect(saved.current_location).toBe(before.current_location);
  expect(saved.field_provenance.crisis_er_utilization.at(-1).source_field_key).toBe("workbook.crisis_er_utilization");
  expect(saved.signed_at).toBeNull();
});

test("invalid or different-client workbooks cannot be committed, and Escape cancels the preview", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic invalid preview", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await openRecoveryTools(page);
  await workbookRuntime(page);
  const wrong = await page.evaluate(async (bytes) => Array.from((await window.workbookTest.exportAssessmentWorkbook(new Uint8Array(bytes), { assessmentId: "different-client", referralId: 999999, origin: location.origin }, window.workbookTest.createEmptyAssessmentToolData())).bytes), Array.from(await fs.readFile(templateFile)));
  const before = await read();
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  for (const bytes of [Buffer.from("not an Excel file"), Buffer.from(wrong)]) {
    await page.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCSS("color", "rgb(89, 100, 94)");
    await expect(dialog.getByRole("alert")).toHaveCSS("background-color", "rgb(247, 250, 249)");
    await expect(dialog.getByRole("button", { name: "Commit changes", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import workbook", exact: true })).toBeFocused();
    expect(await read()).toEqual(before);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Backup & recovery", exact: true })).toHaveCount(0);
  await expect(page.locator('summary[aria-label="Assessment details"]')).toBeFocused();
});

test.describe("compact touch assessment", () => {
test.use({ hasTouch: true, isMobile: true });
test("backup tools stay off the phone questionnaire and return to the same question", async ({ page }, info) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic compact strip", owner: "", tags: [] });
  await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    const pocket = page.locator("[data-phone-interview]");
    await expect(pocket).toBeVisible();
    await expect(page.locator("[data-excel-strip]")).toHaveCount(0);
    await expect(pocket.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    await expect(pocket.getByRole("textbox").first()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`assessment-clear-${size.width}x${size.height}.png`) });
    const question = await pocket.locator("textarea, input").first().getAttribute("id");
    await openRecoveryTools(page);
    const tools = page.getByRole("dialog", { name: "Backup & recovery", exact: true });
    await expect(tools.getByRole("heading", { name: "Save & sync" })).toBeVisible();
    await expect(tools.getByRole("button", { name: "Download current assessment" })).toBeVisible();
    expect(await tools.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`backup-tools-${size.width}x${size.height}.png`) });
    await closeRecoveryTools(page);
    await expect(pocket.locator("textarea, input").first()).toHaveAttribute("id", question!);
    await expect(page.locator('summary[aria-label="Assessment details"]')).toBeFocused();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecoveryTools(page);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  await downloading;
  await closeRecoveryTools(page);
  await expect(page.locator('[data-phone-interview]').getByRole("button", { name: "Next", exact: true })).toBeInViewport();
  await expect(page.locator('[data-phone-interview]').getByRole("textbox").first()).toBeInViewport();
});
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
    await openRecoveryTools(page);
    const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download current assessment", exact: true }).tap();
    const bytes = await fs.readFile((await (await downloading).path())!);
    const changed = changeWorkbook(bytes, [{ sheet: historySheet, cell: "C7", value: "Synthetic tablet update" }]);
    await page.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
    await expect(dialog.getByRole("button", { name: "Commit 1 change", exact: true })).toBeEnabled();
    await expect(dialog).toHaveCSS("opacity", "1");
    await page.screenshot({ path: info.outputPath("ipad-excel-restore.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("webkit-excel-restore.png") });
    await dialog.getByRole("button", { name: "Commit 1 change", exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    expect((await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_awol_failed_placements).toBe("Synthetic tablet update");
    await expect(page.getByRole("button", { name: "Import workbook", exact: true })).toBeFocused();
  } finally { await browser.close(); }
});
