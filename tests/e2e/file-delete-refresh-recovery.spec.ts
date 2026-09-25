import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { createOperationalReferral } from "./support/operational-api";
import { confirmReferralFileLabels } from "./support/referral-upload";

test("a confirmed file deletion stays removed when inventory and chart refreshes fail", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Delete refresh ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart",
    documentName: "", documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=files`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");

  const fileName = `delete-refresh-${randomUUID()}.txt`;
  await page.getByLabel("Choose referral documents").setInputFiles({
    name: fileName, mimeType: "text/plain", buffer: Buffer.from("Synthetic provider form"),
  });
  await confirmReferralFileLabels(page, { [fileName]: "provider_form" });
  const uploaded = page.getByRole("region", { name: "Uploaded documents", exact: true });
  await expect(uploaded.getByRole("button", { name: `Delete ${fileName}`, exact: true })).toBeVisible();
  const inventory = (await (await page.request.get(`/api/files?referral_id=${referral.id}`)).json()) as { files: Array<{ id: string; name: string }> };
  const fileId = inventory.files.find((file) => file.name === fileName)?.id;
  expect(fileId).toBeTruthy();

  let deleted = false;
  let deleteRequests = 0;
  await page.route(`**/api/files/${fileId}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deleteRequests += 1;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    deleted = true;
    return route.fulfill({ response });
  });
  await page.route("**/api/files?**", (route) => deleted
    ? route.fulfill({ status: 503, json: { error: "Synthetic file inventory outage" } }) : route.continue());
  await page.route(`**/api/referrals/${referral.id}/canvas`, (route) => deleted
    ? route.fulfill({ status: 503, json: { error: "Synthetic chart refresh outage" } }) : route.continue());

  await uploaded.getByRole("button", { name: `Delete ${fileName}`, exact: true }).click();
  await page.getByRole("dialog", { name: "Delete this file?", exact: true })
    .getByRole("button", { name: "Delete file", exact: true }).click();

  await expect(uploaded).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Delete this file?", exact: true })).not.toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "The file was deleted, but the file list could not be refreshed." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "The file change was saved." })).toBeVisible();
  expect((await (await page.request.get(`/api/files?referral_id=${referral.id}`)).json()).files).toHaveLength(0);
  expect(deleteRequests).toBe(1);

  deleted = false;
  await page.getByRole("button", { name: "Retry file list", exact: true }).click();
  await expect(page.getByText("No files added yet.", { exact: true })).toBeVisible();
  expect(deleteRequests).toBe(1);
});
