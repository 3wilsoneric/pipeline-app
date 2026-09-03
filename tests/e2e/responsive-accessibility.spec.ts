import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

test.describe("Responsive and accessible application shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("keeps home and referral navigation usable without page overflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /^Good (?:morning|afternoon|evening), .+\.$/ })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
    await expect(page.getByRole("navigation", { name: "Platform pages" })).toHaveCount(0);
    const platformBrand = page.getByRole("img", { name: "Alamo Platform" });
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await expect(platformBrand).toBeVisible();
    } else {
      await expect(platformBrand).toBeHidden();
    }
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create new referral" })).toBeVisible();

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByText("5 suggested searches", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Alamo Platform" })).toHaveCount(0);
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await page.getByRole("button", { name: "Open client profiles" }).click();
    const loadingRoster = page.getByRole("status", { name: "Loading clients" });
    if (await loadingRoster.count()) await expect(loadingRoster).toHaveAttribute("aria-busy", "true");
    await expect(page.getByLabel("Filter profiles by community")).toBeVisible();
    await expect(page.getByLabel("Filter profiles by admission date")).toBeVisible();
    await expect(page.getByLabel("Filter profiles by profile data")).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });

  test("keeps packet steps operable at the configured viewport", async ({ page }) => {
    await page.goto("/?view=referrals&screen=packet");
    await page.waitForLoadState("networkidle");
    const compactSteps = (page.viewportSize()?.width ?? 0) < 1024;
    const stepNavigation = page.getByRole("navigation", { name: "Workspace stages" });
    const stepSelect = page.getByRole("combobox", { name: "Workspace stage" });
    if (compactSteps) {
      await expect(stepNavigation).toBeHidden();
      await expect(stepSelect).toBeVisible();
    } else {
      await expect(stepNavigation).toBeVisible();
      await expect(stepSelect).toBeHidden();
    }
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toBeFocused();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Summary", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit summary", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Workspace files" }).click();
    await expect(page.getByText("Signed Medication List", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    if (compactSteps) {
      await stepSelect.selectOption("2");
    } else {
      await page.getByRole("button", { name: "02 Assessment" }).click();
    }
    await expect(page.getByRole("region", { name: "Assessment", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "03 Decision" })).toHaveCount(0);
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });

  test("provides useful empty and failure recovery states", async ({ page }) => {
    const referralDirectoryRequest = /\/api\/referrals(?:\/directory)?(?:\?|$)/;
    await page.route(referralDirectoryRequest, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          referrals: [],
          total: 0,
          revision: 0,
          next_cursor: null,
          progress: {},
          facets: { communities: [], counties: [], stages: [], owners: [], priorities: [], tags: [], months: [] },
          file_total: 0,
        }),
      });
    });

    await page.goto("/?view=referrals");
    await expect(page.getByText("No workspaces yet", { exact: true })).toBeVisible();
    await expect(page.getByText("Create a referral workspace from an initial face sheet or referral packet to get started.", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await page.unroute(referralDirectoryRequest);
    await page.route(referralDirectoryRequest, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Referral refresh is temporarily unavailable." }),
      });
    });
    await page.getByRole("button", { name: "Current work", exact: true }).click();
    const failure = page.getByRole("alert").filter({ hasText: "Referral refresh is temporarily unavailable." });
    await expect(failure).toContainText("Referral refresh is temporarily unavailable.");
    await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });
});

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function expectNoSeriousAxeViolations(page: Page, contextSelector?: string) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async (selector) => {
    const context = selector ? document.querySelector(selector) : document;
    if (!context) throw new Error(`Accessibility context not found: ${selector}`);
    const result = await (window as unknown as {
      axe: { run: (context: Document | Element, options: object) => Promise<{ violations: Array<{
        id: string;
        impact: string | null;
        nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
      }> }> };
    }).axe.run(context, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 20).map((node) => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      }));
  }, contextSelector);
  expect(violations).toEqual([]);
}
