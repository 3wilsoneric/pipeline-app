import { expect, type Page } from "@playwright/test";

export async function confirmReferralFileLabels(page: Page, categories: Record<string, string> = {}, firstType?: string) {
  const dialog = page.getByRole("dialog", { name: "Label your files", exact: true });
  await expect(dialog).toBeVisible();
  const selects = await dialog.getByRole("combobox").all();
  for (const [index, select] of selects.entries()) {
    const filename = (await select.getAttribute("aria-label"))!.replace("Document type for ", "");
    const category = categories[filename] ?? (index === 0 ? firstType : undefined) ?? (await select.inputValue());
    await select.selectOption(category || "other");
  }
  await dialog.getByRole("button", { name: "Add files", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
