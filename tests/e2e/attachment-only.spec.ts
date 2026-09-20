import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { expect, test, webkit, type Page } from "@playwright/test";

for (const phone of [false, true]) test(`${phone ? "iPhone WebKit" : "desktop"}: attachments save once, open, and require confirmed deletion without reading`, async ({ page: desktop, baseURL }, info) => {
  test.setTimeout(90_000);
  const { page, close } = await attachmentPage(phone, desktop, baseURL);
  try {
    const canvas = createCanvas(160, 60);
    const drawing = canvas.getContext("2d");
    drawing.fillStyle = "white"; drawing.fillRect(0, 0, 160, 60);
    drawing.fillStyle = "black"; drawing.fillText("Synthetic attachment", 10, 30);
    const files = [
      { name: "intake-note.txt", mimeType: "text/plain", buffer: Buffer.from("DOB: 01/15/1980. Resident Name: Never Autofill") },
      { name: "care-note.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("synthetic office attachment bytes") },
      { name: "archive.zip", mimeType: "application/zip", buffer: Buffer.from("synthetic archive bytes") },
      { name: "tiny.custom", mimeType: "", buffer: Buffer.from("a") },
      { name: "photo.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") },
    ];
    const readingCalls: string[] = [];
    const creations: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/uploads\/preview|\/packets\/.*\/(fields|status)|\/sync-packet/.test(path)) readingCalls.push(path);
      if (path === "/api/referrals" && request.method() === "POST") creations.push(path);
    });
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    const name = `Attachments A${randomUUID().replace(/[^a-f]/g, "")}`;
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
    await page.getByTestId("document-checklist-toggle").click();
    await page.getByTestId("initial-packet-input").setInputFiles(files);
    await expect(page.getByRole("region", { name: "Reading intake files" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Extraction review" })).toHaveCount(0);
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const id = new URL(page.url()).searchParams.get("referralId");
    const inventory = async (): Promise<{ id: string; name: string; downloadUrl: string }[]> => (await (await page.request.get(`/api/files?referral_id=${id}`)).json()).files;
    await expect.poll(async () => (await inventory()).map((file) => file.name).sort()).toEqual(files.map((file) => file.name).sort());
    expect(creations).toHaveLength(1);
    let saved = (await (await page.request.get(`/api/referrals/${id}`)).json()).referral;
    expect(saved.name).toBe(name);
    expect(saved.dob ?? "").toBe("");
    expect(saved.packetFields ?? []).toHaveLength(0);
    await page.reload();
    if (phone) await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label: "Files" });
    else await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    const list = page.getByRole("region", { name: "Uploaded documents", exact: true });
    // A repeat selection after reload reuses the stored document.
    await page.getByLabel("Choose additional referral documents").setInputFiles(files[1]);
    await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
    expect(await inventory()).toHaveLength(files.length);
    for (const expected of files) {
      const file = (await inventory()).find((item) => item.name === expected.name)!;
      const original = await page.request.get(file.downloadUrl);
      expect(original.ok()).toBeTruthy();
      expect(await original.body()).toEqual(expected.buffer);
      if (expected.name.endsWith(".docx")) expect(original.headers()["content-disposition"]).toContain("attachment");
    }
    for (const filename of ["intake-note.txt", "photo.png", "care-note.docx"]) {
      await list.getByRole("button", { name: `Preview ${filename}`, exact: true }).click();
      const preview = page.getByRole("dialog", { name: `Preview ${filename}`, exact: true });
      if (filename.endsWith(".docx")) {
        await expect(preview.getByText("This file type opens in its original application.")).toBeVisible();
        await expect(preview.locator("iframe")).toHaveCount(0);
      } else {
        await expect(preview.locator("iframe")).toBeVisible();
        const src = await preview.locator("iframe").getAttribute("src");
        expect((await page.request.get(src!)).ok()).toBeTruthy();
      }
      await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    }
    const target = (await inventory()).find((file) => file.name === "intake-note.txt")!;
    expect((await page.request.delete(`/api/files/${target.id}`, { data: { confirmed: false } })).status()).toBe(400);
    await list.getByRole("button", { name: `Delete ${target.name}` }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete this file?" });
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await inventory()).toHaveLength(files.length);
    await list.getByRole("button", { name: `Delete ${target.name}` }).click();
    await confirmation.getByRole("button", { name: "Delete file", exact: true }).click();
    await expect.poll(async () => (await inventory()).length).toBe(files.length - 1);
    expect((await page.request.get(target.downloadUrl)).status()).toBe(404);
    saved = (await (await page.request.get(`/api/referrals/${id}`)).json()).referral;
    expect(saved.name).toBe(name);
    expect(readingCalls).toEqual([]);
    await page.screenshot({ path: info.outputPath("attachment-only.png"), animations: "disabled" });
  } finally { await close(); }
});

async function attachmentPage(phone: boolean, desktop: Page, baseURL?: string) {
  if (!phone) return { page: desktop, close: async () => {} };
  const browser = await webkit.launch();
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  return { page: await context.newPage(), close: async () => { await context.close(); await browser.close(); } };
}
