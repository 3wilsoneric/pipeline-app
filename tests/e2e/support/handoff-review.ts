import { expect, type Page } from "@playwright/test";

export async function openAdmitDate(page: Page) {
  const inline = page.getByRole("region", { name: "Prepare client handoff", exact: true });
  if (await inline.isVisible()) return inline;
  await page.getByRole("button", { name: "Review handoff", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm admit date", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Confirm admit date", exact: true })).toBeFocused();
  return dialog;
}
export async function openSummary(page: Page) {
  const review = await openFiles(page);
  await review.locator("details > summary").click();
  return review;
}
export async function openFiles(page: Page) {
  const inline = page.getByRole("region", { name: "Review client handoff", exact: true });
  if (await inline.isVisible()) return inline;
  const dateInline = page.getByRole("region", { name: "Prepare client handoff", exact: true });
  if (await dateInline.isVisible()) {
    const field = dateInline.getByLabel("Planned admit date", { exact: true });
    if (!await field.inputValue()) await field.fill("2026-10-01");
    await dateInline.getByRole("button", { name: "Confirm admit date", exact: true }).click();
    await expect(inline).toBeVisible();
    return inline;
  }
  await page.getByRole("button", { name: /^(Review handoff|Continue review)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Review handoff", exact: true });
  if (!await dialog.isVisible()) {
    const date = page.getByRole("dialog", { name: "Confirm admit date", exact: true });
    const field = date.getByLabel("Planned admit date", { exact: true });
    if (!await field.inputValue()) await field.fill("2026-10-01");
    await date.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  }
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function openRecipients(page: Page) {
  return openFiles(page);
}
export async function confirmRecipients(page: Page) {
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  const inline = page.getByRole("region", { name: "Review client handoff", exact: true });
  const review = await inline.isVisible() ? inline : page.getByRole("dialog", { name: "Review handoff", exact: true });
  await review.getByRole("button", { name: "Preview email", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
