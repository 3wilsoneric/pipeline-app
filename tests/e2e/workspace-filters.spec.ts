import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";

const facets = {
  communities: [{ value: "San Pablo", count: 4 }, { value: "Santa Clarita", count: 4 }, { value: "Turlock", count: 4 }],
  owners: [{ value: "Alex Assessor", count: 6 }, { value: "Blair Assessor", count: 6 }],
  counties: [{ value: "Contra Costa County", count: 12 }], stages: [], priorities: [], tags: [],
  months: [{ value: "2026-09", count: 12, communities: [{ value: "San Pablo", count: 4 }, { value: "Santa Clarita", count: 4 }] }],
};

async function choose(page: Page, label: string, choices: string[]) {
  const trigger = page.getByRole("button", { name: label, exact: true });
  await trigger.focus();
  await trigger.press("Space");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const group = page.getByRole("group", { name: label, exact: true });
  for (const choice of choices) await group.getByRole("checkbox", { name: choice, exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(group).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

for (const width of [1440, 390]) {
  test(`workspace and file filters support multiple values without losing other selections at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    let directoryParams = new URLSearchParams();
    let fileParams = new URLSearchParams();
    await page.route(/\/api\/referrals(?:\/directory)?\?/, async (route) => {
      directoryParams = new URL(route.request().url()).searchParams;
      await route.fulfill({ json: {
        referrals: [{ id: 910001, name: "Filter Test Client", date: "2026-09-17", stage: "New", community: "San Pablo", owner: "Alex Assessor", priority: "standard", source: "Synthetic", requirements: [], documentName: "filter.pdf", documentStatus: "Uploaded", note: "", createdAt: "2026-09-17T12:00:00Z" }],
        total: 12, revision: 1, progress: {}, facets, file_total: 12,
        next_cursor: directoryParams.has("cursor") ? undefined : "fixture-page-2",
      } });
    });
    await page.route(/\/api\/files\?/, async (route) => {
      fileParams = new URL(route.request().url()).searchParams;
      await route.fulfill({ json: { files: [{ id: "file-fixture", name: "Filter referral.pdf", referralId: 910001, referralName: "Filter Test Client", category: "Referral packet", community: "San Pablo", owner: "Alex Assessor", uploadedAt: "2026-09-17T12:00:00Z", status: "Uploaded", previewStatus: "unavailable" }], total: 1 } });
    });
    await page.goto("/?view=referrals");
    await expect(page.getByRole("region", { name: "Referral worklist" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Workspace scope" })).toHaveCount(0);
    await expect(page.getByText("Recently updated first", { exact: true })).toHaveCount(0);
    const directory = page.getByRole("main", { name: "Referral workspaces" });
    await expect(directory.getByText("Workspaces", { exact: true })).toHaveCount(0);
    const directoryBox = (await directory.boundingBox())!;
    const searchBox = (await page.getByLabel("Search all workspaces", { exact: true }).boundingBox())!;
    expect(searchBox.y - directoryBox.y).toBeLessThanOrEqual(32);
    expect(directoryParams.get("scope")).toBe("team");
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Show workspaces as/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    if (width < 640) await page.getByRole("button", { name: "Filters", exact: true }).click();
    await choose(page, "Filter workspaces by community", ["San Pablo", "Santa Clarita"]);
    await expect.poll(() => directoryParams.getAll("community")).toEqual(["San Pablo", "Santa Clarita"]);
    await expect.poll(() => directoryParams.has("cursor")).toBe(false);
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await choose(page, "Filter by owner", ["Alex Assessor", "Blair Assessor"]);
    await expect.poll(() => directoryParams.getAll("owner")).toEqual(["Alex Assessor", "Blair Assessor"]);
    expect(directoryParams.getAll("community")).toEqual(["San Pablo", "Santa Clarita"]);
    await page.getByRole("combobox", { name: "Filter workspaces by county" }).selectOption("Contra Costa County");
    await expect.poll(() => directoryParams.get("county")).toBe("Contra Costa County");
    expect(directoryParams.getAll("owner")).toHaveLength(2);
    const communities = page.getByRole("button", { name: "Filter workspaces by community", exact: true });
    const owners = page.getByRole("button", { name: "Filter by owner", exact: true });
    await expect(communities).toHaveText("2 communities");
    await expect(owners).toHaveText("2 owners");
    await communities.click();
    await page.getByRole("group", { name: "Filter workspaces by community", exact: true }).getByRole("checkbox", { name: "San Pablo", exact: true }).uncheck();
    await owners.click();
    await expect(page.getByRole("group", { name: "Filter workspaces by community", exact: true })).not.toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Alex Assessor", exact: true })).toBeChecked();
    await expect.poll(() => directoryParams.getAll("community")).toEqual(["Santa Clarita"]);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[data-guide-target="workspace-directory"]', { runOnly: ["color-contrast", "label", "button-name"] })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
    });
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`workspace-filters-${width}.png`) });
    await page.keyboard.press("Escape");
    if (width < 1280) await page.getByRole("button", { name: "Browse workspaces by month and community" }).click();
    await page.getByRole("button", { name: /September 2026/ }).click();
    await expect.poll(() => directoryParams.get("month")).toBe("2026-09");
    expect(directoryParams.getAll("community")).toEqual(["Santa Clarita"]);
    expect(directoryParams.getAll("owner")).toHaveLength(2);
    if (width < 1280) await page.getByRole("button", { name: "Close referral browser" }).click();
    await communities.click();
    await page.getByRole("group", { name: "Filter workspaces by community", exact: true }).getByRole("button", { name: "All communities", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect.poll(() => directoryParams.getAll("community")).toEqual([]);
    expect(directoryParams.getAll("owner")).toHaveLength(2);
    expect(directoryParams.get("month")).toBe("2026-09");
    await page.getByRole("button", { name: "All files", exact: true }).click();
    await choose(page, "Filter files by community", ["San Pablo", "Santa Clarita"]);
    await choose(page, "Filter files by owner", ["Alex Assessor", "Blair Assessor"]);
    await expect.poll(() => fileParams.getAll("community")).toEqual(["San Pablo", "Santa Clarita"]);
    await expect.poll(() => fileParams.getAll("owner")).toEqual(["Alex Assessor", "Blair Assessor"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect.poll(() => fileParams.getAll("community")).toEqual([]);
    expect(fileParams.getAll("owner")).toEqual([]);
  });
}

test("HTTP query validation rejects invalid additional filter values", async ({ request }) => {
  for (const path of ["/api/referrals", "/api/referrals/directory", "/api/files"]) {
    const response = await request.get(`${path}?owner=Alex&owner=${"x".repeat(201)}`);
    expect(response.status()).toBe(400);
    expect((await request.get(`${path}?${Array(51).fill("community=San+Pablo").join("&")}`)).status()).toBe(400);
  }
  expect((await request.get("/api/referrals/directory?community=San+Pablo&community=Invalid")).status()).toBe(400);
});
