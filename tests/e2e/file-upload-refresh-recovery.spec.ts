import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { createOperationalReferral } from "./support/operational-api";
import { confirmReferralFileLabels } from "./support/referral-upload";

test("a saved file stays saved when the chart refresh fails", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `File refresh ${randomUUID().slice(0, 8)}`,
    owner: "Annette Everhart",
    documentName: "",
    documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  const fileName = `saved-${randomUUID()}.pdf`;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=files`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const files = page.getByRole("region", { name: "Document checklist" });
  await expect(files).toBeVisible();

  let completedUploads = 0;
  let failChartRefresh = false;
  await page.route(`**/api/referrals/${referral.id}/canvas`, async (route) => {
    if (failChartRefresh) {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Synthetic chart refresh outage"}' });
    } else {
      await route.continue();
    }
  });
  await page.route("**/api/uploads/complete", async (route) => {
    const response = await route.fetch();
    if (response.ok()) {
      completedUploads += 1;
      failChartRefresh = true;
    }
    await route.fulfill({ response });
  });

  await files.getByTestId("referral-documents-input").setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}\n`),
  });
  await confirmReferralFileLabels(page, {}, "provider_form");

  const refreshWarning = page.getByRole("status").filter({ hasText: "The file change was saved." });
  await expect(refreshWarning).toBeVisible();
  await expect(files.getByText(fileName, { exact: true })).toBeVisible();
  await expect(page.getByTestId("workspace-save-status")).not.toContainText("Not saved to Pipeline");
  await expect(page.getByRole("button", { name: "Retry saving" })).toHaveCount(0);
  expect(completedUploads).toBe(1);

  const saved = await page.request.get(`/api/files?referral_id=${referral.id}&limit=200`);
  expect(saved.ok()).toBe(true);
  expect((await saved.json() as { files: Array<{ name: string }> }).files.filter((file) => file.name === fileName)).toHaveLength(1);

  const canvas = await page.request.get(`/api/referrals/${referral.id}/canvas`);
  expect(canvas.ok()).toBe(true);
  const savedReferral = (await canvas.json() as {
    referral: { requirements?: Array<{ type: string; status: string; evidenceDocumentName?: string }> };
  }).referral;
  const providerForm = savedReferral.requirements?.find((requirement) => requirement.type === "provider_form");
  expect(providerForm).toMatchObject({ status: "received", evidenceDocumentName: fileName });

  failChartRefresh = false;
  await page.evaluate((referralId) => window.dispatchEvent(new CustomEvent("pipeline:documents-changed", { detail: { referralId } })), referral.id);
  await expect(refreshWarning).toHaveCount(0);
  expect(completedUploads).toBe(1);
});
