import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("keeps intake and later referral files in one workspace", async ({ page }) => {
  test.setTimeout(90_000);
  const name = `Batch File Client ${randomUUID().slice(0, 8)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("initial-packet-input").setInputFiles([
    { name: "batch-face-sheet.pdf", mimeType: "application/pdf", buffer: Buffer.from(`packet-${name}`) },
    { name: "batch-referral-note.pdf", mimeType: "application/pdf", buffer: Buffer.from(`note-${name}`) },
  ]);
  await expect(page.getByRole("list", { name: "Additional referral file list" })).toContainText("batch-referral-note.pdf");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
  const referralId = Number(new URL(page.url()).searchParams.get("referralId"));
  await expect.poll(async () => {
    const response = await page.request.get(`/api/files?referral_id=${referralId}`);
    const payload = await response.json() as { files: { name: string }[] };
    return payload.files.map((file) => file.name);
  }).toContain("batch-referral-note.pdf");

  await page.getByRole("button", { name: "Workspace files" }).click();
  await page.getByLabel("Choose additional referral documents").setInputFiles({
    name: "later-care-note.pdf", mimeType: "application/pdf", buffer: Buffer.from(`later-${name}`),
  });
  await expect.poll(async () => {
    const response = await page.request.get(`/api/files?referral_id=${referralId}`);
    const payload = await response.json() as { files: { name: string }[] };
    return payload.files.map((file) => file.name);
  }).toContain("later-care-note.pdf");
  await expect(page.getByRole("list", { name: "Additional referral file list" })).toContainText("later-care-note.pdf");

  const invalid = await page.request.get("/api/files?referral_id=not-a-number");
  expect(invalid.status()).toBe(400);
});
