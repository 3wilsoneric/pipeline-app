import { expect, test, type Page } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";
import { confirmReferralFileLabels } from "./support/referral-upload";

async function openWorkspace(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic Files ${randomUUID()}`, owner: "Annette Everhart", documentName: "", documentStatus: "Missing", phone: "555-0101",
  }, { assigneeId: "provisional:allo:annette" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=files`);
  return referral;
}

function syntheticImage() {
  const canvas = createCanvas(400, 500);
  const drawing = canvas.getContext("2d");
  drawing.fillStyle = "white";
  drawing.fillRect(0, 0, 400, 500);
  drawing.fillStyle = "#173c2b";
  drawing.font = "20px sans-serif";
  drawing.fillText("SYNTHETIC DOCUMENT", 30, 50);
  return { name: "synthetic-assessment-note.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") };
}

async function addImage(page: Page) {
  const file = syntheticImage();
  await page.getByLabel("Choose referral documents").setInputFiles(file);
  await confirmReferralFileLabels(page, { [file.name]: "assessment" });
  await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
  return file;
}

test("file-list failures are explicit, preserve known files, and retry without a page reload", async ({ page }) => {
  const referral = await openWorkspace(page);
  await expect(page.getByText("No files added yet.", { exact: true })).toBeVisible();
  const file = await addImage(page);
  const uploaded = page.getByRole("region", { name: "Uploaded documents", exact: true });
  await expect(uploaded.getByRole("button", { name: file.name, exact: true })).toBeVisible();
  await page.route("**/api/files?**", (route) => route.fulfill({ status: 503, json: { error: "Synthetic file-list failure" } }));
  await page.evaluate((referralId) => window.dispatchEvent(new CustomEvent("pipeline:documents-changed", { detail: { referralId } })), referral.id);
  const error = page.getByRole("alert").filter({ hasText: "The file list could not be loaded" });
  await expect(error).toContainText("may be out of date");
  await expect(uploaded).toBeVisible();
  await expect(page.getByText("No files added yet.", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(error).toBeVisible();
  await expect(page.getByText("No files added yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Drop files or choose files/ })).toBeEnabled();
  await page.unroute("**/api/files?**");
  await error.getByRole("button", { name: "Retry file list" }).click();
  await expect(error).toHaveCount(0);
  await expect(uploaded.getByRole("listitem")).toHaveCount(1);
});

test("preview retries in place, contains focus, and restores it after close or Escape", async ({ page }, info) => {
  await openWorkspace(page);
  const file = await addImage(page);
  const trigger = page.getByRole("button", { name: `Preview ${file.name}`, exact: true });
  await page.route(/\/api\/files\/[^/?]+\?after_page=/, (route) => route.fulfill({ status: 503, json: { error: "Synthetic preview interruption" } }));
  await trigger.click();
  const preview = page.getByRole("dialog", { name: `Preview ${file.name}`, exact: true });
  const close = preview.getByRole("button", { name: "Close preview", exact: true });
  await expect(close).toBeFocused();
  await expect(preview.getByRole("alert")).toContainText("The preview could not be loaded");
  await page.keyboard.press("Tab");
  await expect(preview.getByRole("button", { name: "Retry preview" })).toBeFocused();
  await trigger.evaluate((element) => element.focus());
  await expect(preview.getByRole("button", { name: "Retry preview" })).toBeFocused();
  await page.unroute(/\/api\/files\/[^/?]+\?after_page=/);
  await preview.getByRole("button", { name: "Retry preview" }).click();
  await expect(preview.locator("iframe")).toBeVisible();
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("preview-desktop.png") });
  await close.click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await preview.getByRole("button", { name: "Close file preview", exact: true }).click({ position: { x: 12, y: 400 } });
  await expect(preview).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(close).toBeInViewport();
  await expect(preview.getByRole("link", { name: "Open original", exact: true })).toBeInViewport();
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("preview-phone.png") });
});

test("phone file controls preserve deduplication, delete confirmation, failure recovery and audit history", async ({ page }, info) => {
  const referral = await openWorkspace(page);
  const files = async (): Promise<Array<{ id: string; name: string }>> => (await (await page.request.get(`/api/files?referral_id=${referral.id}`)).json()).files;
  const file = await addImage(page);
  await addImage(page);
  expect(await files()).toHaveLength(1);
  const record = (await files())[0];
  const uploaded = page.getByRole("region", { name: "Uploaded documents", exact: true });
  await page.screenshot({ path: info.outputPath("files-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const remove = uploaded.getByRole("button", { name: `Delete ${file.name}`, exact: true });
  const box = await remove.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("files-phone.png") });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Delete this file?", exact: true });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await files()).toHaveLength(1);
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(confirmation).not.toBeVisible();
  expect(await files()).toHaveLength(1);
  await page.route(`**/api/files/${record.id}`, (route) => route.request().method() === "DELETE"
    ? route.fulfill({ status: 500, json: { error: "Synthetic delete failure" } }) : route.continue());
  await remove.click();
  await confirmation.getByRole("button", { name: "Delete file", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toBeVisible();
  expect(await files()).toHaveLength(1);
  await page.unroute(`**/api/files/${record.id}`);
  await confirmation.getByRole("button", { name: "Delete file", exact: true }).click();
  await expect.poll(async () => (await files()).length).toBe(0);
  await expect(uploaded).toHaveCount(0);
  await expect(page.getByText("No files added yet.", { exact: true })).toBeVisible();
  const activity: { events: Array<{ action: string }> } = await (await page.request.get(`/api/referrals/${referral.id}/activity`)).json();
  expect(activity.events.filter((event) => event.action === "document_uploaded")).toHaveLength(1);
  expect(activity.events.filter((event) => event.action === "document_deleted")).toHaveLength(1);
  expect((await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.phone).toBe("555-0101");
});

test("a partially failed upload batch retries without duplicating successful files", async ({ page }) => {
  const referral = await openWorkspace(page);
  const names = async (): Promise<string[]> => (await (await page.request.get(`/api/files?referral_id=${referral.id}`)).json()).files.map((file: { name: string }) => file.name).sort();
  await page.route("**/api/uploads/create-url", (route) => route.request().postData()?.includes("second-note.txt")
    ? route.fulfill({ status: 503, json: { error: "Synthetic upload interruption" } }) : route.continue());
  await page.getByLabel("Choose referral documents").setInputFiles([
    { name: "first-note.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic first file") },
    { name: "second-note.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic second file") },
  ]);
  await confirmReferralFileLabels(page);
  await expect(page.getByRole("button", { name: "Retry saving", exact: true })).toBeEnabled();
  expect(await names()).toEqual(["first-note.txt"]);
  await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("second-note.txt");
  await page.unroute("**/api/uploads/create-url");
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect.poll(names).toEqual(["first-note.txt", "second-note.txt"]);
  await expect(page.getByRole("list", { name: "Queued referral files" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Uploaded documents", exact: true }).getByRole("listitem")).toHaveCount(2);
});
