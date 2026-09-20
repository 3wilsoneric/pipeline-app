import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

test.describe("Responsive and accessible application shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("keeps home and referral navigation usable without page overflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
    await expect(page.getByRole("navigation", { name: "Platform pages" })).toHaveCount(0);
    const phone = (page.viewportSize()?.width ?? 0) < 640;
    if (phone) await page.getByRole("button", { name: /^Open page menu/ }).click();
    else await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
    const platformBrand = page.getByRole("img", { name: "Alamo Health Management" });
    if (!phone) await expect(platformBrand).toBeVisible();
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create new referral" })).toBeVisible();

    if (phone) await page.getByRole("button", { name: "Close page menu", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
    await page.keyboard.press("/");
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByText("5 suggested searches", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
    await page.keyboard.press("Escape");
    if (phone) await page.getByRole("button", { name: /^Open page menu/ }).click();
    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await page.route("**/api/profiles/directory**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ json: clientDirectoryFixture });
    });
    // A fresh document exercises the cold loader; warm navigation may already have prefetched it.
    await page.goto("/?screen=profiles");
    const loadingRoster = page.getByRole("status", { name: "Loading clients" });
    await expect(loadingRoster).toBeVisible();
    await expect(loadingRoster).toHaveAttribute("aria-busy", "true");
    await expect(loadingRoster.locator(".pipeline-directory-loader__segment")).toHaveCount(8);
    await expect(page.getByLabel("Filter profiles by community")).toHaveCount(0);
    await page.getByRole("button", { name: /file cabinet$/ }).first().click();
    await expect(page.getByLabel("Filter profiles by admission date")).toBeVisible();
    await expect(page.getByLabel("Filter profiles by profile data")).toHaveCount(0);
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });

  test("keeps packet steps operable at the configured viewport", async ({ page }) => {
    await page.goto("/?view=referrals&screen=packet");
    await page.waitForLoadState("networkidle");
    const compactSteps = (page.viewportSize()?.width ?? 0) < 640;
    const stepNavigation = page.getByRole("navigation", { name: "Workspace stages" });
    const stepSelect = page.getByRole("combobox", { name: "Workspace view" });
    if (compactSteps) {
      await expect(stepNavigation).toBeVisible();
      await expect(stepSelect).toBeVisible();
    } else {
      await expect(stepNavigation).toBeVisible();
      await expect(stepSelect).toBeHidden();
    }
    const name = page.getByRole("textbox", { name: "NAME", exact: true });
    await name.fill(`Accessible ${crypto.randomUUID().replace(/[^a-z]/g, "")}`);
    await expect(name).toBeFocused();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
    if (compactSteps) await stepSelect.selectOption("files");
    else await page.getByRole("button", { name: "Workspace files" }).click();
    await expect(page.getByText("Signed Medication List", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await expect(stepNavigation.getByRole("button", { name: "Assessment", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect(page).toHaveURL(/referralId=\d+/);
    if (compactSteps) await stepSelect.selectOption({ label: "Assessment" });
    else await page.getByRole("button", { name: "Assessment", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assessment", exact: true })).toBeVisible();
    if (compactSteps) await expect(stepSelect.getByRole("option", { name: "Decision", exact: true })).toHaveCount(1);
    else await expect(page.getByRole("button", { name: "Decision", exact: true })).toBeVisible();
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
    await page.getByLabel("Search all workspaces").fill("trigger refresh failure");
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
