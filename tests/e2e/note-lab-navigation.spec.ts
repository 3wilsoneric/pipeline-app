import { expect, test } from "@playwright/test";

test("the former language route resolves to the combined question workflow", async ({ page }) => {
  const response = await page.goto("/note-lab");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/note-lab\/practice$/);
  await expect(page.getByTestId("standalone-review-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pipeline home" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open guided tutorials" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open profile menu for/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: /Pipeline/i })).toHaveCount(0);
  await expect(page.locator("a")).toHaveCount(0);

  const rail = page.getByRole("complementary", { name: "Assessment section navigation" });
  await expect(rail.getByRole("button", { name: /^Client & referral\b/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Save and continue", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Begin walkthrough for/ })).toHaveCount(1);
  await expect(page.getByText("Writing guide", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Note help", { exact: true })).toHaveCount(0);

  await rail.getByRole("button", { name: /^History\b/ }).click();
  await page.getByRole("button", { name: "Begin walkthrough for History" }).click();
  await expect(rail.getByRole("button", { name: /^History\b/ })).toHaveAttribute("aria-current", "step");
  const guidance = page.getByRole("dialog", { name: "Guided step for Prior placements" });
  await expect(guidance).toBeVisible();
  await expect(guidance.getByText("Use this order", { exact: true })).toBeVisible();
  await expect(guidance.getByText("Example", { exact: true })).toBeVisible();
  await expect(guidance.locator("li")).toHaveCount(0);
  await expect(page.getByText("What to capture", { exact: true })).toHaveCount(0);
  await expect(page.getByText("How to answer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Note structure", { exact: true })).toHaveCount(0);

  await guidance.getByRole("button", { name: "Next field" }).click();
  await expect(page.getByRole("dialog", { name: "Guided step for Prior AWOL / failed placements" })).toBeVisible();

  await page.reload();
  await expect(rail.getByRole("button", { name: /^Client & referral\b/ })).toHaveAttribute("aria-current", "step");
});
