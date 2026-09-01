import { expect, test } from "@playwright/test";

test("the former language route resolves to the combined question workflow", async ({ page }) => {
  const response = await page.goto("/note-lab");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/note-lab\/practice$/);

  const rail = page.getByRole("complementary", { name: "Assessment question navigation" });
  await expect(rail.getByRole("button", { name: "Resident name", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Save and continue", { exact: true })).toHaveCount(0);

  await rail.getByRole("button", { name: "Date of birth", exact: true }).click();
  const guidance = page.getByRole("dialog", { name: "Date of birth" });
  await expect(guidance).toBeVisible();
  await guidance.getByRole("button", { name: "OK, go to question" }).click();
  await expect(page.getByRole("dialog", { name: "Guided step for Date of birth" })).toBeVisible();

  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByRole("dialog", { name: "Resident number" })).toBeVisible();

  await page.reload();
  await expect(rail.getByRole("button", { name: "Resident name", exact: true })).toHaveAttribute("aria-current", "step");
});
