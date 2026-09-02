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
  await expect(page.getByRole("button", { name: "Save and continue" })).toBeVisible();
  await expect(page.getByText("Autosaved in this browser", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next section" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open guide for/ })).toHaveCount(0);
  await expect(page.getByText("Writing guide", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Note help", { exact: true })).toHaveCount(0);

  await rail.getByRole("button", { name: /^History\b/ }).click();
  await expect(rail.getByRole("button", { name: /^History\b/ })).toHaveAttribute("aria-current", "step");
  const priorPlacementGuide = page.locator("details").filter({ has: page.getByLabel("Guide for Prior placements") });
  await expect(priorPlacementGuide).not.toHaveAttribute("open", "");
  await page.getByLabel("Guide for Prior placements").click();
  await expect(priorPlacementGuide).toHaveAttribute("open", "");
  await expect(priorPlacementGuide.getByText("Use this order", { exact: true })).toBeVisible();
  await expect(priorPlacementGuide.getByText("Example", { exact: true })).toBeVisible();
  await expect(priorPlacementGuide.locator("li")).toHaveCount(0);
  await expect(page.getByText("What to capture", { exact: true })).toHaveCount(0);
  await expect(page.getByText("How to answer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Note structure", { exact: true })).toHaveCount(0);

  await page.getByLabel("Guide for Prior placements").click();
  await expect(priorPlacementGuide).not.toHaveAttribute("open", "");
  const priorAwolGuide = page.locator("details").filter({ has: page.getByLabel("Guide for Prior AWOL / failed placements") });
  await expect(priorAwolGuide).not.toHaveAttribute("open", "");
  await page.getByLabel("Guide for Prior AWOL / failed placements").click();
  await expect(priorAwolGuide).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Next field" })).toHaveCount(0);

  await page.reload();
  await expect(rail.getByRole("button", { name: /^History\b/ })).toHaveAttribute("aria-current", "step");
});
