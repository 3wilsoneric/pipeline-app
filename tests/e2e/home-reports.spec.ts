import { expect, test } from "@playwright/test";

test.describe("role-scoped home and reports", () => {
  test("presents the operational briefing without dashboard clutter", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Last 24 hours" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();
    await expect(page.getByText("Team view", { exact: true })).toBeVisible();
    await expect(page.getByText("Email to decision flow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Community snapshot", { exact: true })).toHaveCount(0);
  });

  test("runs a report, exposes only contextual filters, and exports the current scope", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open reports" }).click();

    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current workflow", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Report library" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();

    await page.getByRole("button", { name: "View Assessment schedule report" }).click();
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report owner" })).toBeVisible();

    await page.getByRole("button", { name: "View Assessment completion report" }).click();
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Report owner" })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pipeline-assessment_completion-\d{4}-\d{2}\.csv$/);
  });
});
