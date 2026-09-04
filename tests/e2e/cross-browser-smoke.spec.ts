import { expect, test } from "@playwright/test";

test("core Pipeline surfaces render and navigate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();

  await page.getByRole("button", { name: "Open referrals" }).click();
  await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();

  await page.goto("/?screen=profiles");
  await expect(page.getByLabel("Search clients")).toBeVisible();

  await page.goto("/?screen=operations");
  await expect(page.getByTestId("operations-workspace")).toBeVisible();
  await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Report library" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Report controls" })).toBeVisible();
});
