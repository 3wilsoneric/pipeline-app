import { expect, type Page } from "@playwright/test";

export async function openAdmitDate(page: Page) {
  await page.getByRole("button", { name: "Review handoff", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm admit date", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Confirm admit date", exact: true })).toBeFocused();
  return dialog;
}
export async function openSummary(page: Page) {
  const date = await openAdmitDate(page);
  const field = date.getByLabel("Planned admit date", { exact: true });
  if (!await field.inputValue()) await field.fill("2026-10-01");
  await date.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Check client summary", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Check client summary", exact: true })).toBeFocused();
  return dialog;
}
export async function openFiles(page: Page) {
  await openSummary(page);
  await page.getByRole("button", { name: "Confirm summary", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Check admission packet", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function openRecipients(page: Page) {
  await openFiles(page);
  await page.getByRole("button", { name: "Confirm packet", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Check recipients", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function confirmRecipients(page: Page) {
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  await page.getByRole("dialog", { name: "Check recipients", exact: true }).getByRole("button", { name: "Preview email", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
