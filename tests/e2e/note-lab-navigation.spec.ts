import { expect, test } from "@playwright/test";

test("the former language route resolves to the combined question workflow", async ({ page }) => {
  const response = await page.goto("/note-lab");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/note-lab\/practice$/);

  const rail = page.getByRole("complementary", { name: "Assessment section navigation" });
  await expect(rail.getByRole("button", { name: /^Client & referral\b/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Save and continue", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Open writing guide for Resident name" })).toHaveCount(0);
  await rail.getByRole("button", { name: "Start walkthrough for History" }).click();
  await expect(rail.getByRole("button", { name: /^History\b/ })).toHaveAttribute("aria-current", "step");
  const guidance = page.getByRole("dialog", { name: "Prior placements" });
  await expect(guidance).toBeVisible();
  await guidance.getByRole("button", { name: "OK, go to question" }).click();
  await expect(page.getByRole("dialog", { name: "Guided step for Prior placements" })).toBeVisible();

  await page.getByRole("button", { name: "Next guided field" }).click();
  await expect(page.getByRole("dialog", { name: "Prior AWOL / failed placements" })).toBeVisible();

  await page.reload();
  await expect(rail.getByRole("button", { name: /^Client & referral\b/ })).toHaveAttribute("aria-current", "step");
});
