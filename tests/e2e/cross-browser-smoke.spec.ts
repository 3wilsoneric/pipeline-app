import { expect, test } from "@playwright/test";

test("core Pipeline surfaces render and navigate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome, Playwright QA." })).toBeVisible();

  await page.getByRole("link", { name: "Open referrals" }).click();
  await expect(page.getByRole("heading", { name: "Referral packets", exact: true })).toBeVisible();

  await page.goto("/?screen=profiles");
  await expect(page.getByLabel("Search admitted clients")).toBeVisible();

  await page.goto("/?screen=operations");
  await expect(page.getByTestId("operations-workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
});
