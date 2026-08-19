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
    await expect(page.getByRole("heading", { name: "Welcome, Playwright QA." })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
    await expect(page.getByRole("navigation", { name: "Platform pages" })).toBeVisible();

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByText("6 suggested searches", { exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("heading", { name: "Referral packets", exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);

    await page.getByRole("button", { name: "Open client profiles" }).click();
    const loadingRoster = page.getByRole("status", { name: "Loading admitted clients" });
    if (await loadingRoster.count()) await expect(loadingRoster).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Add community filter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add admission date filter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add profile data filter" })).toBeVisible();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page);
  });

  test("keeps packet steps operable at the configured viewport", async ({ page }) => {
    await page.goto("/?view=referrals&screen=packet");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation", { name: "Referral packet steps" })).toBeVisible();
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Summary", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toBeFocused();
    await expectNoPageOverflow(page);
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Summary", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit summary", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "2 Required files" }).click();
    await expect(page.getByText("Signed Medication List", { exact: true })).toBeVisible();
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
