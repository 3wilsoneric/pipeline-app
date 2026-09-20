import { confirmReferralFileLabels } from "./support/referral-upload";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("a draft recovers queued bytes and document labels before referral creation", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Encrypted intake recovery uses the desktop draft store.");
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Robin Recovery");
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles([
    { name: "recovery-a.txt", mimeType: "text/plain", buffer: Buffer.from("Recovery document A") },
    { name: "recovery-b.txt", mimeType: "text/plain", buffer: Buffer.from("Recovery document B") },
  ]);
  await confirmReferralFileLabels(page, { "recovery-a.txt": "medication_list", "recovery-b.txt": "provider_form" });
  await expect(page.getByTestId("workspace-save-status")).toContainText("Saved on this device");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Robin Recovery");
  await page.getByTestId("document-checklist-toggle").click();
  const queued = page.getByRole("list", { name: "Queued referral files" });
  await expect(queued).toContainText("Medication list");
  await expect(queued).toContainText("Provider form");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
  const id = new URL(page.url()).searchParams.get("referralId");
  const inventory = async () => (await (await page.request.get(`/api/files?referral_id=${id}`)).json()).files as { name: string; category: string; downloadUrl: string }[];
  await expect.poll(async () => (await inventory()).length).toBe(2);
  for (const file of await inventory()) {
    expect(file.category).toBe(file.name === "recovery-a.txt" ? "Medication list" : "Provider form");
    expect(await (await page.request.get(file.downloadUrl)).text()).toBe(file.name === "recovery-a.txt" ? "Recovery document A" : "Recovery document B");
  }
});

test("keeps intake and later referral files in one workspace", async ({ page }) => {
  test.setTimeout(90_000);
  const name = `Batch File Client ${randomUUID().slice(0, 8)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles([
    { name: "batch-face-sheet.pdf", mimeType: "application/pdf", buffer: Buffer.from(`packet-${name}`) },
    { name: "batch-referral-note.pdf", mimeType: "application/pdf", buffer: Buffer.from(`note-${name}`) },
  ]);
  await confirmReferralFileLabels(page, { "batch-face-sheet.pdf": "referral_packet", "batch-referral-note.pdf": "assessment" });
  await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("batch-referral-note.pdf");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
  const referralId = Number(new URL(page.url()).searchParams.get("referralId"));
  await expect.poll(async () => {
    const response = await page.request.get(`/api/files?referral_id=${referralId}`);
    const payload = await response.json() as { files: { name: string }[] };
    return payload.files.map((file) => file.name);
  }).toContain("batch-referral-note.pdf");
  const categorized = (await (await page.request.get(`/api/files?referral_id=${referralId}`)).json()).files;
  expect(categorized.find((file: { name: string }) => file.name === "batch-face-sheet.pdf").category).toBe("Referral packet");
  expect(categorized.find((file: { name: string }) => file.name === "batch-referral-note.pdf").category).toBe("Assessment");

  await page.getByRole("button", { name: "Workspace files" }).click();
  await page.getByLabel("Choose referral documents").setInputFiles({
    name: "later-care-note.pdf", mimeType: "application/pdf", buffer: Buffer.from(`later-${name}`),
  });
    await confirmReferralFileLabels(page);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/files?referral_id=${referralId}`);
    const payload = await response.json() as { files: { name: string }[] };
    return payload.files.map((file) => file.name);
  }).toContain("later-care-note.pdf");
  await expect(page.getByRole("region", { name: "Uploaded documents", exact: true })).toContainText("later-care-note.pdf");

  const invalid = await page.request.get("/api/files?referral_id=not-a-number");
  expect(invalid.status()).toBe(400);
});
