import { expect, test } from "@playwright/test";

test.describe("role-scoped home and reports", () => {
  test("presents the operational briefing without dashboard clutter", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
    await expect(page.getByText("Team view", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Email to decision flow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Community snapshot", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Last 24 hours" })).toHaveCount(0);
  });

  test("keeps the assessor home personal and omits supervisor metrics", async ({ page }) => {
    await page.route("**/api/operations/home", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generated_at: "2026-09-03T12:00:00.000Z",
          scope: "personal",
          viewer: { id: "assessor-1", name: "Alex Assessor" },
          current_work: { total: 0, items: [] },
          workflow: {
            generated_at: "2026-09-03T12:00:00.000Z",
            active_total: 0,
            unassigned_total: 0,
            overall_completion_pct: null,
            flow_counts: {
              ready_to_schedule: 0,
              scheduled: 0,
              assessment: 0,
              complete_chart: 0,
            },
            active_items: [],
            ready_to_schedule: { total: 0, items: [] },
            data_completion: { total: 0, items: [] },
            current_work: {
              generated_at: "2026-09-03T12:00:00.000Z",
              owner: { id: "assessor-1", name: "Alex Assessor" },
              total: 0,
              items: [],
            },
          },
          upcoming: [],
          unscheduled: [],
          unscheduled_total: 0,
          unavailable_sections: [],
        }),
      });
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toHaveCount(0);
    await expect(page.getByText("Your work", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toContainText("0 active referrals");
    await expect(page.getByRole("region", { name: "Current work" })).toContainText("No active referral work");
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toContainText("No assessments are scheduled");
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
  });

  test("runs a report, exposes only contextual filters, and exports the current scope", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open reports" }).click();

    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View Workspaces report" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Report library" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();

    await page.getByRole("button", { name: "View Assessment calendar report" }).click();
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report owner" })).toBeVisible();

    await page.getByRole("button", { name: "View Completed assessments report" }).click();
    await expect(page.getByLabel("Report month")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Report community" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Report owner" })).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^pipeline-assessment_completion-\d{4}-\d{2}\.csv$/);
  });
});
