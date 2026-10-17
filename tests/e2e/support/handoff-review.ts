import { expect, type Page } from "@playwright/test";

export async function openAdmitDate(page: Page) {
  await page.getByRole("button", { name: "Review handoff", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm admit date", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Confirm admit date", exact: true })).toBeFocused();
  return dialog;
}
export async function openSummary(page: Page) {
  const dialog = await openFiles(page);
  await expect(dialog.getByRole("heading", { name: "Review handoff", exact: true })).toBeFocused();
  await dialog.locator("details > summary").click();
  return dialog;
}
export async function openFiles(page: Page) {
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
  await page.getByRole("dialog", { name: "Review handoff", exact: true }).getByRole("button", { name: "Preview email", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
