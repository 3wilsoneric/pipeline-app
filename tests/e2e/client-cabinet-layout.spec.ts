import { expect, test } from "@playwright/test";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";

const communities = ["San Pablo", "Turlock", "Victoria's House", "JC Wallace House", "Santa Clarita"];

for (const engine of ["chromium", "webkit"] as const) {
  for (const width of [1440, 834, 390, 320]) {
    test(`${engine} stacked community cabinets fit at ${width}px`, async ({ playwright, baseURL }, testInfo) => {
      const browser = await playwright[engine].launch();
      try {
        const height = width === 320 ? 480 : width < 400 ? 640 : 900;
        const page = await browser.newPage({ baseURL, viewport: { width, height }, hasTouch: width < 960 });
        await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
          ...clientDirectoryFixture,
          clients: communities.map((community, index) => ({
            ...clientDirectoryFixture.clients[0], canonical_client_id: `cabinet-${index}`,
            display_name: ["Avery Example", "Blair Example", "Casey Example", "Drew Example", "Ellis Example"][index], profile_key: `cabinet-${index}`,
            current_community: community, community_names: [community],
          })), total: communities.length, next_cursor: null,
        } }));
        await page.goto("/?screen=profiles");
        const directory = page.getByRole("main", { name: "Client profiles", exact: true });
        const group = page.getByRole("group", { name: "Community file cabinets", exact: true });
        const cabinets = group.getByRole("button");
        await expect(cabinets).toHaveCount(5);
        const bounds = await cabinets.evaluateAll((nodes) => nodes.map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
        for (const [index, rect] of bounds.entries()) {
          expect(rect.x).toBe(bounds[0].x);
          expect(rect.width).toBe(bounds[0].width);
          expect(rect.x + rect.width).toBeLessThanOrEqual(width);
          expect(rect.height).toBeGreaterThanOrEqual(72);
          if (index) expect(rect.y).toBeGreaterThanOrEqual(bounds[index - 1].y + bounds[index - 1].height);
          if (width >= 834) expect(rect.y + rect.height).toBeLessThanOrEqual(height);
        }
        expect(await group.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await directory.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`cabinet-stack-${engine}-${width}.png`) });
        await cabinets.last().scrollIntoViewIfNeeded();
        await expect(cabinets.last()).toBeInViewport();
        const scrollBefore = await directory.evaluate((node) => node.scrollTop);
        if (width === 320) expect(scrollBefore).toBeGreaterThan(0);
        if (width < 960) await cabinets.last().tap();
        else { await cabinets.last().focus(); await page.keyboard.press("Enter"); }
        const drawer = page.getByRole("region", { name: "Victoria's House file cabinet", exact: true });
        await expect(drawer).toBeVisible();
        await expect(drawer.getByRole("button", { name: "Open profile for Casey Example", exact: true })).toBeInViewport();
        await expect(drawer.getByLabel("Sort clients")).toBeVisible();
        await page.getByRole("button", { name: "Back to cabinets", exact: true }).click();
        await expect(cabinets.last()).toBeFocused();
        await expect(cabinets.last()).toBeInViewport();
        expect(await directory.evaluate((node) => node.scrollTop)).toBeCloseTo(scrollBefore, 0);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await cabinets.last().press("Enter");
        expect(await drawer.evaluate((node) => node.getAnimations().length)).toBe(0);
        await page.keyboard.press("Escape");
        await expect(cabinets.last()).toBeFocused();
      } finally { await browser.close(); }
    });
  }
}
