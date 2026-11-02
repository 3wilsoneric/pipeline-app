import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const context = { community: "San Pablo", owner: "Alex Morgan", source_name: "County behavioral health", referring_county: "Contra Costa", prior_placement: "Community hospital" };
const reason = "The county arranged a placement closer to the client’s family.\n\nOriginal correspondence: <img src=x onerror=alert(1)>\nThank you,\nCounty placement team";
const report = {
  generated_at: "2026-11-02T04:00:00Z", board_columns: [],
  briefing: {
    window_end: "2026-11-01", week_start: "2026-10-26", week_end: "2026-11-01", last_week_start: "2026-10-19", last_week_end: "2026-10-25",
    coverage: { admitted_last_week_complete: true, move_ins_complete: true, moving_through_complete: true, did_not_move_in_complete: true },
    admitted_last_week: [{ ...context, client_name: "Jordan Ellis", admitted_at: "2026-10-22", pipeline_path: "/?view=referrals&screen=packet&referralId=901" }],
    planned_move_ins: [{ ...context, client_name: "Morgan Wells", planned_at: "2026-11-01", readiness: "ready", pipeline_path: "/?view=referrals&screen=packet&referralId=902" }],
    moving_through: [
      { ...context, client_name: "Casey Brooks", stage: "decision", phase: "needs_date", planned_at: null, status: "Accepted · no planned admit date", pipeline_path: "/?view=referrals&screen=packet&referralId=903" },
      { ...context, client_name: "Drew Bennett", stage: "in_progress", phase: "intake_assessment", planned_at: null, status: "Assessment underway", pipeline_path: "/?view=referrals&screen=packet&referralId=904" },
    ],
    did_not_move_in: [
      { ...context, client_name: "Avery Taylor", cancelled_at: "2026-10-19T04:17:02Z", status: "Did not move in", recorded_by: "Sam Rivera", reason, pipeline_path: "/?view=referrals&screen=packet&referralId=905" },
      { ...context, client_name: "Riley Parker", cancelled_at: "2026-10-20T20:42:49Z", status: "Did not move in", recorded_by: "Alex Morgan", reason: "The referring team selected a different care setting.", pipeline_path: "/?view=referrals&screen=packet&referralId=906" },
      { ...context, client_name: "Taylor Quinn", cancelled_at: "2026-10-22T20:00:00Z", status: "Did not move in", recorded_by: null, reason: null, pipeline_path: "/?view=referrals&screen=packet&referralId=907" },
    ],
  },
};

for (const width of [1440, 390]) {
  test(`admissions focus and report drill-down at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.route("**/api/auth/me", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.user.email = "reports@pipeline.local";
      payload.user.roles = ["admin"];
      delete payload.user.demoPersona;
      await route.fulfill({ response, json: payload });
    });
    await page.route("**/api/operations/admissions-census", (route) => route.fulfill({ json: report }));
    await page.route("**/api/clinical/census", (route) => route.fulfill({ json: {
      source: "alamo_platform", snapshot_id: "synthetic-briefing", generated_at: report.generated_at, data_as_of: "2026-11-01", retrieved_at: report.generated_at,
      freshness: { status: "fresh", age_hours: 0, max_age_hours: 24, warning: null }, portfolio_census_total: 108, roster_count: 108, reconciliation_status: "matched", delta: 0,
      communities: [
        { community_id: "337", community_name: "San Pablo", current_census: 72, roster_count: 72, reconciliation_status: "matched", delta: 0 },
        { community_id: "342", community_name: "Victoria’s House", current_census: 36, roster_count: 36, reconciliation_status: "matched", delta: 0 },
      ],
    } }));
    await page.goto("/?screen=operations");
    const main = page.getByRole("main", { name: "Reports" });
    await expect(main.getByRole("heading", { name: "Admissions & census" })).toBeVisible();
    await expect(main.getByRole("link", { name: /Jordan Ellis/ })).toHaveAttribute("href", /referralId=901/);
    await page.screenshot({ path: testInfo.outputPath(`report-${width}.png`), fullPage: true });

    await expect(main.getByRole("heading", { name: /Placement did not happen|Did not move in|Placement cancelled/ })).toHaveCount(0);
    for (const name of ["Avery Taylor", "Riley Parker", "Taylor Quinn"]) {
      await expect(main.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
    }
    const details = page.getByRole("region", { name: "Admitted last week" }).locator("details");
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details.getByText("Contra Costa", { exact: true })).toBeVisible();
    await expect(details.getByText("Community hospital", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: { run: (element: Element, options: object) => Promise<{ violations: unknown[] }> } }).axe.run(document.querySelector('[data-testid="operations-workspace"]')!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      return result.violations;
    });
    expect(violations).toEqual([]);
    const moving = page.getByRole("region", { name: "Clients moving through" });
    await moving.getByRole("button", { name: /Intake & assessment/ }).click();
    await expect(moving.getByRole("link", { name: /Drew Bennett/ })).toBeVisible();
    await expect(moving.getByRole("link", { name: /Casey Brooks/ })).toHaveCount(0);
    await moving.getByRole("button", { name: "View all 2" }).click();
    await expect(moving.getByRole("link", { name: /Casey Brooks/ })).toBeVisible();
  });
}
