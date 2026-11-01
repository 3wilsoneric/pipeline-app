import { expect, type Page } from "@playwright/test";

export async function showTutorialHelp(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
  const profile = page.getByRole("button", { name: /^Open profile menu for/ });
  if (!await profile.isVisible()) await page.getByRole("button", { name: /^Open page menu/ }).click();
  const help = page.getByRole("button", { name: "Open guided tutorials", exact: true });
  if (!await help.isVisible()) await profile.click();
  await expect(help).toBeVisible();
  return help;
}
