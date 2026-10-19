import { expect, type Page } from "@playwright/test";

export async function openAdmitDate(page: Page) {
  const inline = page.getByRole("region", { name: "Review client handoff", exact: true });
  const review = page.getByRole("button", { name: "Review handoff", exact: true });
  await expect(inline.or(review)).toBeVisible();
  if (await inline.isVisible()) return inline;
  try {
    await review.click({ timeout: 3_000 });
  } catch (error) {
    // Hydration can replace the temporary overview with the inline review.
    try { await expect(inline).toBeVisible({ timeout: 3_000 }); }
    catch { throw error; }
    return inline;
  }
  const dialog = page.getByRole("dialog", { name: "Review handoff", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Review handoff", exact: true })).toBeFocused();
  return dialog;
}
export async function openSummary(page: Page) {
  const review = await openAdmitDate(page);
  await review.locator("details > summary").click();
  return review;
}
export async function openFiles(page: Page) {
  const review = await openAdmitDate(page);
  const field = review.getByLabel("Planned admit date", { exact: true });
  if (!await field.inputValue() && await field.isEnabled()) {
    try { await field.fill("2026-10-01", { timeout: 2_000 }); }
    catch (error) { if (await field.isEnabled()) throw error; }
  }
  return review;
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
