import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";
import { changeWorkbook } from "./support/workbook-runtime";
import { assessmentWorkbookFields, assessmentWorkbookLayout } from "../../lib/assessment/assessment-workbook-contract";
import type { AssessmentWorkbookRestoreSource, PipelineAssessmentRecord } from "../../lib/assessment/assessment-records";
const historySheet = assessmentWorkbookLayout.findIndex((section) => section.key === "prior_history") + 2;

test.beforeEach(() => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires canonical and encrypted recovery drafts.");
});

test("Keep mine after offline conflict and reload retains the workbook source and import audit", async ({ page }) => {
  const fixture = await createFixture(page, "Synthetic workbook conflict");
  await page.goto(fixture.href);
  const bytes = await downloadCopy(page);
  const changed = changeWorkbook(bytes, [{ sheet: historySheet, cell: "C7", value: "Synthetic offline workbook answer" }]);
  let source: AssessmentWorkbookRestoreSource | undefined;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(fixture.api)) source ??= request.postDataJSON()?.patch?.workbook_restore;
  });
  await page.context().setOffline(true);
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  try {
    await chooseCopy(page, changed);
    await dialog.getByRole("button", { name: "Commit 1 change", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const current = await fixture.read();
    const response = await page.request.patch(fixture.api, { data: { if_match: current.version, client_mutation_id: randomUUID(), patch: { data: { prior_awol_failed_placements: "Synthetic remote answer" } } } });
    expect(response.status(), await response.text()).toBe(200);
  } finally { await page.context().setOffline(false); }
  await expect(page.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
  // Exercise the existing working-set debounce, then discard all in-memory refs.
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Synthetic offline workbook answer");
  await page.getByRole("button", { name: "Keep mine", exact: true }).click();
  await expect.poll(async () => (await fixture.read()).prior_awol_failed_placements).toBe("Synthetic offline workbook answer");
  expect(source).toBeDefined();
  const saved = await fixture.read();
  expectWorkbookSource(saved, "prior_awol_failed_placements", source!);
  expect(saved.audit_events.filter((event) => event.action === "assessment_imported" && event.changed_fields.includes("prior_awol_failed_placements"))).toHaveLength(1);
});

for (const manuallyReplace of [false, true]) {
  test(`interrupted multi-section workbook import resumes after reopening${manuallyReplace ? " with a manual replacement kept manual" : " with source and audit intact"}`, async ({ page, context }) => {
    const fixture = await createFixture(page, "Synthetic interrupted workbook");
    await page.goto(fixture.href);
    const bytes = await downloadCopy(page);
    const location = assessmentWorkbookFields.find((field) => field.key === "current_location")!;
    const changed = changeWorkbook(bytes, [
      { sheet: assessmentWorkbookLayout.findIndex((section) => section.sheet === location.sheet) + 2, cell: `C${location.row}`, value: "Synthetic imported location" },
      { sheet: historySheet, cell: "C7", value: "Synthetic imported AWOL answer" },
      { sheet: historySheet, cell: "C11", value: "Synthetic imported crisis answer" },
    ]);
    let source: AssessmentWorkbookRestoreSource | undefined;
    let firstSaved = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**${fixture.api}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      source = route.request().postDataJSON().patch.workbook_restore;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      firstSaved = true;
      await held;
      if (!page.isClosed()) await route.fulfill({ response });
    });
    try {
      await chooseCopy(page, changed);
      await page.locator('dialog[aria-describedby="excel-preview-description"]').getByRole("button", { name: "Commit 3 changes", exact: true }).click();
      await expect.poll(() => firstSaved).toBe(true);
      expect((await fixture.read()).current_location).toBe("Synthetic imported location");
      expect((await fixture.read()).prior_awol_failed_placements).toBeNull();
      await expect.poll(async () => (await (await context.request.get(fixture.draftApi)).json()).draft?.workbookSources?.prior_awol_failed_placements).toEqual(source);
      // Closing the page stops the JavaScript loop before the next section is
      // queued. The new page must use durable recovery, not the offline queue.
      await page.close();
      release();
      const reopened = await context.newPage();
      await reopened.goto(fixture.href);
      await expect(reopened.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Synthetic imported AWOL answer");
      if (manuallyReplace) {
        await reopened.getByRole("button", { name: "Edit Crisis / ER utilization", exact: true }).click();
        const input = reopened.locator("#assessment-crisis_er_utilization");
        await input.fill("Synthetic manual replacement");
        await input.blur();
        await expect.poll(async () => (await fixture.read()).crisis_er_utilization).toBe("Synthetic manual replacement");
      }
      await reopened.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true }).click();
      await expect.poll(async () => (await fixture.read()).prior_awol_failed_placements).toBe("Synthetic imported AWOL answer");
      const saved = await fixture.read();
      expectWorkbookSource(saved, "current_location", source!);
      expectWorkbookSource(saved, "prior_awol_failed_placements", source!);
      expect(saved.audit_events.filter((event) => event.action === "assessment_imported")).toHaveLength(2);
      if (manuallyReplace) {
        expect(saved.field_provenance.crisis_er_utilization?.at(-1)?.source_field_key).toBe("manual.crisis_er_utilization");
        expect(saved.field_provenance.crisis_er_utilization?.at(-1)?.evidence_url).toBeNull();
        expect(saved.audit_events.some((event) => event.action === "assessment_updated" && event.changed_fields.includes("crisis_er_utilization"))).toBe(true);
      } else {
        expect(saved.crisis_er_utilization).toBe("Synthetic imported crisis answer");
        expectWorkbookSource(saved, "crisis_er_utilization", source!);
      }
      expect(saved.signed_at).toBeNull();
      await reopened.close();
    } finally { release(); }
  });
}

function expectWorkbookSource(record: PipelineAssessmentRecord, field: "current_location" | "prior_awol_failed_placements" | "crisis_er_utilization", source: AssessmentWorkbookRestoreSource) {
  expect(record.field_provenance[field]?.at(-1)).toMatchObject({
    source_field_key: `workbook.${field}`, source_file: `Excel backup ${source.export_id}`,
    evidence_url: `workbook://${source.export_id}?exported=${encodeURIComponent(source.exported_at)}`,
  });
}

async function createFixture(page: Page, name: string) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const api = `/api/assessments/${assessment.assessment_id}`;
  return {
    api, draftApi: `/api/me/assessment-drafts/${assessment.assessment_id}`,
    href: `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`,
    read: async (): Promise<PipelineAssessmentRecord> => (await (await page.request.get(api)).json()).assessment,
  };
}

async function downloadCopy(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  return fs.readFile((await (await pending).path())!);
}

async function chooseCopy(page: Page, bytes: Buffer) {
  await page.getByLabel("Choose workbook").setInputFiles({ name: "synthetic.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes });
}
