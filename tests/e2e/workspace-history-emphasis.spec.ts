import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { workspaceMonthKey } from "../../lib/pipeline/workspace-month.mjs";
import { isEarlierWorkspaceMonth } from "../../lib/pipeline/workspace-presentation";

const base = { stage: "New", community: "San Pablo", owner: "Alex Assessor", priority: "standard", source: "Synthetic", requirements: [], documentName: "", documentStatus: "Missing", note: "", createdAt: "2026-09-18T12:00:00Z", updatedAt: "2026-09-18T12:00:00Z" };
const referrals = [
  { ...base, id: 910001, name: "August Example", date: "2026-08-31" },
  { ...base, id: 910002, name: "September Example", date: "2026-09-01" },
  { ...base, id: 910003, name: "Imported Example", date: "2026-09-18", workspaceOrigin: "allo" as const, sourceProjectName: "August 2026", sourceMaterialCount: 4 },
  { ...base, id: 910004, name: "Undated Example", date: "2026-08-15", workspaceOrigin: "allo" as const, sourceProjectName: "Undated records" },
];
const facets = {
  communities: [{ value: "San Pablo", count: 4 }], owners: [{ value: "Alex Assessor", count: 4 }], counties: [], stages: [], priorities: [], tags: [],
  months: ["2026-09", "2026-08", "unknown"].map((value) => ({ value, count: 2, communities: [{ value: "San Pablo", count: 2 }] })),
};

test("workspace emphasis has a fixed September 2026 boundary and does not guess unknown dates", () => {
  for (const [month, earlier] of [["2025-09", true], ["2026-08", true], ["2026-09", false], ["2026-10", false], ["unknown", false], ["", false], ["2026-00", false]] as const) {
    expect(isEarlierWorkspaceMonth(month)).toBe(earlier);
  }
  expect(referrals.map((referral) => isEarlierWorkspaceMonth(workspaceMonthKey(referral)))).toEqual([true, false, true, false]);
});

for (const width of [1440, 390]) {
  test(`older workspaces are quieter but remain reachable, with unnumbered views at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let params = new URLSearchParams();
    await page.route(/\/api\/referrals(?:\/directory)?\?/, async (route) => {
      params = new URL(route.request().url()).searchParams;
      await route.fulfill({ json: { referrals, total: 4, revision: 1, progress: {}, facets, file_total: 1234 } });
    });
    await page.route(/\/api\/files\?/, (route) => route.fulfill({ json: { files: [], total: 0 } }));
    await page.goto("/?view=referrals");
    const worklist = page.getByRole("region", { name: "Referral worklist" });
    const august = worklist.getByRole("button", { name: "Open August Example referral workspace", exact: true });
    const september = worklist.getByRole("button", { name: "Open September Example referral workspace", exact: true });
    await expect(august).toBeVisible();
    await expect(august).toBeEnabled();
    await expect(august).toHaveAttribute("data-earlier-workspace", "true");
    await expect(august.locator("[data-workspace-name]")).toHaveCSS("font-weight", "500");
    await expect(august.locator("[data-workspace-name]")).toHaveCSS("color", "rgb(89, 100, 94)");
    await expect(august.getByTestId("workspace-chart-thumbnail")).toHaveCSS("filter", "grayscale(1)");
    await expect(september).toHaveAttribute("data-earlier-workspace", "false");
    await expect(september.locator("[data-workspace-name]")).toHaveCSS("font-weight", "600");
    await expect(worklist.getByRole("button", { name: "Open Imported Example referral workspace", exact: true })).toHaveAttribute("data-earlier-workspace", "true");
    await expect(worklist.getByRole("button", { name: "Open Undated Example referral workspace", exact: true })).toHaveAttribute("data-earlier-workspace", "false");
    for (const label of ["All workspaces", "All files"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).not.toContainText(/\d/);
    }
    if (width < 1280) await page.getByRole("button", { name: "Browse workspaces by month and community" }).click();
    const month = page.getByRole("button", { name: /August 2026/ });
    await expect(month.locator("span").first()).toHaveCSS("font-weight", "500");
    await month.click();
    await expect.poll(() => params.get("month")).toBe("2026-08");
    await expect(month).toHaveAttribute("aria-current", "page");
    await expect(month.locator("span").first()).toHaveCSS("font-weight", width < 1280 ? "900" : "600");
    if (width < 1280) await page.getByRole("button", { name: "Close referral browser" }).click();
    await page.getByRole("button", { name: "All files", exact: true }).click();
    await expect(page.getByRole("button", { name: "All files", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "All workspaces", exact: true }).click();
    await expect(august).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath(`workspace-emphasis-${width}.png`) });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Referral worklist"]', { runOnly: ["color-contrast", "button-name"] })).violations;
    });
    expect(violations).toEqual([]);
    await august.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("910001");
  });
}
