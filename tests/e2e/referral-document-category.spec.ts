import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

test("a spreadsheet is labeled as a document without an assessment workbook import", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic document labeling", owner: "", tags: [] });
  await createOperationalAssessment(page.request, referral.id);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
  await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles({
    name: "assessment-working-copy.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("Synthetic file for document labeling"),
  });
  const labeling = page.getByRole("dialog", { name: "Label your files", exact: true });
  await expect(labeling.getByRole("combobox")).toHaveValue("assessment");
  await expect(labeling.getByRole("option", { name: "Pipeline assessment workbook" })).toHaveCount(0);
  await expect(labeling.getByRole("button", { name: "Preview workbook" })).toHaveCount(0);
  await labeling.getByRole("button", { name: "Add files" }).click();
  await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("assessment-working-copy.xlsx");
  await expect(page.getByRole("dialog", { name: "Excel import preview" })).toHaveCount(0);
});
