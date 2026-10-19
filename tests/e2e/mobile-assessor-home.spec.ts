import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";

test.use({ serviceWorkers: "block" });

for (const width of [320, 390]) test(`phone home prioritizes assigned assessments and keeps search accessible at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const assigned = {
      board: { stage: "in_progress", detail: "Assessment underway", next_action: "Continue assessment", location: { view: "assessment" } },
      referral_id: 424244,
      client_name: "Assigned Mobile Client",
      community: "Turlock",
      stage: "Assessment",
      workflow_status: "assessment_in_progress",
      assessment_state: "in_progress",
      flow_state: "assessment",
      outcome_state: "pending",
      assignment_state: "assigned",
      document_state: "partial",
      profile_state: "partial",
      assessment_is_reassessment: false,
      owner: "Example Assessor",
      priority: "standard",
      categories: [],
      primary_category: "follow_up",
      next_action: "Continue assessment",
      blockers: [],
      missing_data: [],
      urgency: "normal",
      due_at: null,
      last_activity_at: "2026-10-19T15:00:00Z",
      age_hours: 1,
      completion_pct: 40,
      missing_document_count: 1,
      location: { view: "assessment", assessmentSection: "identity" },
    };
    payload.workflow.board_items = [assigned];
    payload.workflow.active_items = [assigned];
    payload.workflow.all_board_items = [assigned, { ...assigned, referral_id: 424245, client_name: "Team Only Client" }];
    payload.continuity.new_assignments = [];
    payload.continuity.resume_items = [];
    payload.unavailable_sections = [];
    await route.fulfill({ response, json: payload });
  });

  await page.goto("/");
  const home = page.getByTestId("mobile-assessor-home");
  await expect(home.getByRole("heading", { name: "My assessments" })).toBeVisible();
  await expect(home).toContainText("Assigned Mobile Client");
  await expect(home).not.toContainText("Team Only Client");
  await expect(page.locator("[data-current-work-board]")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('[data-testid="mobile-assessor-home"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`mobile-assessor-home-${width}.png`), animations: "disabled" });

  await home.getByRole("button", { name: "View full Home" }).click();
  await expect(page.getByTestId("home-focus-deck")).toBeVisible();
  await page.getByRole("button", { name: "My assessments" }).click();
  await expect(home).toBeVisible();

  await home.getByRole("button", { name: "Search clients and files" }).click();
  await expect(page.getByRole("dialog", { name: "Search Pipeline" })).toBeVisible();
  await page.getByRole("dialog", { name: "Search Pipeline" }).getByRole("button", { name: /Close/ }).click();
  await home.getByRole("button", { name: /Assigned Mobile Client.*Continue assessment/ }).click();
  await expect(page).toHaveURL(/referralId=424244.*workspaceStage=assessment/);
});

test("desktop keeps the existing home deck", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("mobile-assessor-home")).toBeHidden();
  await expect(page.locator("[data-current-work-board]")).toBeVisible();
});
