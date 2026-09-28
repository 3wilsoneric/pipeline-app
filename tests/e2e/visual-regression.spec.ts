import { expect, test, type Page } from "@playwright/test";

import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";

const generatedAt = "2026-09-20T12:00:00.000Z";
const viewer = { id: "visual-assessor", name: "Example Assessor" };
const homeFixture: HomeBriefingSnapshot = {
  generated_at: generatedAt,
  scope: "personal",
  viewer,
  current_work: { total: 0, items: [] },
  workflow: {
    generated_at: generatedAt,
    active_total: 0,
    unassigned_total: 0,
    overall_completion_pct: null,
    flow_counts: { ready_to_schedule: 0, scheduled: 0, assessment: 0, complete_chart: 0 },
    active_items: [], board_items: [], all_board_items: [],
    ready_to_schedule: { total: 0, items: [] },
    data_completion: { total: 0, items: [] },
    current_work: { generated_at: generatedAt, owner: viewer, total: 0, items: [] },
  },
  upcoming: [], unscheduled: [], unscheduled_total: 0,
  continuity: {
    resume_items: [], new_assignments: [], assignment_tracking_started_at: generatedAt,
    needs_assignment_tracking_initialization: false, unavailable: false,
  },
  unavailable_sections: [],
};

test.describe("Stable visual surfaces", () => {
  test.skip(process.env.PIPELINE_VISUAL_REGRESSION !== "true", "Visual baselines run in the isolated visual gate.");

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-20T12:00:00Z"));
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.route("**/api/profiles/directory**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(clientDirectoryFixture),
    }));
    // Screenshots must not inherit records or saved layouts from another spec.
    await page.route("**/api/me/home-layout", (route) => route.fulfill({ json: { layout: null } }));
    await page.route("**/api/operations/home", (route) => route.fulfill({ json: homeFixture }));
    await page.route(/\/api\/referrals(?:\/directory|\/changes)?(?:\?|$)/, (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (new URL(route.request().url()).pathname.endsWith("/changes")) {
        return route.fulfill({ json: { changed: false, sequence: 1 } });
      }
      return route.fulfill({ json: {
        referrals: [], total: 0, revision: 1, next_cursor: null, progress: {}, file_total: 0,
        facets: { communities: [], counties: [], stages: [], owners: [], priorities: [], tags: [], months: [] },
      } });
    });
  });

  test("desktop home matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await expect(page).toHaveScreenshot("desktop-home.png", screenshotOptions());
  });

  test("desktop referrals match their baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    await settleStable(page);
    await expect(page).toHaveScreenshot("desktop-referrals.png", screenshotOptions());
  });

  test("desktop profiles match their baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Community file cabinets" }).getByRole("button").first()).toBeVisible();
    await expect(page.getByTestId("profiles-workspace").getByRole("alert")).toHaveCount(0);
    await settleStable(page);
    await expect(page).toHaveScreenshot("desktop-profiles.png", screenshotOptions());
  });

  test("desktop new referral intake matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect(page.getByRole("region", { name: "Intake", exact: true })).toBeVisible();
    await settleStable(page);
    await expect(page).toHaveScreenshot("desktop-new-packet.png", screenshotOptions());
  });

  test("mobile referrals match their baseline", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStable(page, "/?view=referrals");
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    await expect(page).toHaveScreenshot("mobile-referrals.png", screenshotOptions());
  });

  test("mobile new referral intake matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStable(page, "/?view=referrals");
    await page.getByRole("button", { name: /^Open page menu/ }).click();
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect(page.getByRole("region", { name: "Intake", exact: true })).toBeVisible();
    await settleStable(page);
    const create = page.getByRole("button", { name: "Create referral", exact: true });
    await expect(create.locator("svg")).toBeVisible();
    expect(await create.evaluate((button) => getComputedStyle(button, "::before").content)).toBe("none");
    await expect(page).toHaveScreenshot("mobile-new-packet.png", screenshotOptions());
  });
});

async function openStable(page: Page, url: string) {
  await page.goto(url);
  await settleStable(page);
}

async function settleStable(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

function screenshotOptions() {
  return {
    animations: "disabled" as const,
    caret: "hide" as const,
    fullPage: false,
    maxDiffPixelRatio: 0.002,
    scale: "css" as const,
  };
}
