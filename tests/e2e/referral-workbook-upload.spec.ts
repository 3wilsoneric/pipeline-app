import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";
import { changeWorkbook, workbookRuntime } from "./support/workbook-runtime";
import { assessmentWorkbookFields, assessmentWorkbookLayout } from "../../lib/assessment/assessment-workbook-contract";

test("a labeled workbook opens the canonical preview without uploading or changing answers", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Rowan Upload", owner: "", tags: [] });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
  await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
  await workbookRuntime(page);
  const bytes = Array.from(await fs.readFile("public/templates/pipeline-assessment-workbook.xlsx"));
  const original = await page.evaluate(async ({ bytes, assessmentId, referralId }) => {
    const w = window.workbookTest;
    return Array.from((await w.exportAssessmentWorkbook(new Uint8Array(bytes), { assessmentId, referralId, origin: location.origin }, w.createEmptyAssessmentToolData())).bytes);
  }, { bytes, assessmentId: assessment.assessment_id, referralId: referral.id });
  const field = assessmentWorkbookFields.find((entry) => entry.key === "prior_placements")!;
  const changed = changeWorkbook(new Uint8Array(original), [{ sheet: assessmentWorkbookLayout.findIndex((section) => section.sheet === field.sheet) + 2, cell: `C${field.row}`, value: "Synthetic workbook care history" }]);
  const uploads: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/uploads\//.test(request.url())) uploads.push(request.url()); });
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles({ name: "assessment-working-copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
  const labeling = page.getByRole("dialog", { name: "Label your files", exact: true });
  await expect(labeling.getByRole("combobox")).toHaveValue("workbook");
  await labeling.getByRole("button", { name: "Preview workbook" }).click();
  const preview = page.locator('dialog[aria-describedby="excel-preview-description"]');
  await expect(preview.getByRole("region", { name: "Populated assessment preview" })).toContainText("Synthetic workbook care history");
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect((await read()).prior_placements ?? "").toBe("");
  expect(uploads).toEqual([]);
  await preview.getByRole("button", { name: /Commit \d+ change/ }).click();
  await expect.poll(async () => (await read()).prior_placements).toBe("Synthetic workbook care history");
  expect(uploads).toEqual([]);
});

test("workbook restoration before a referral exists explains the separate route", async ({ page }) => {
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles({ name: "pipeline-assessment-workbook.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("Not read until preview") });
  const labeling = page.getByRole("dialog", { name: "Label your files", exact: true });
  await expect(labeling.getByRole("status")).toContainText("first create the referral and open its assessment");
  await expect(labeling.getByRole("button", { name: "Preview workbook" })).toBeDisabled();
  await labeling.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("list", { name: "Queued referral files" })).toHaveCount(0);
});
