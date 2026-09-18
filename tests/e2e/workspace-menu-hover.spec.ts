import { chromium, expect, test, webkit } from "@playwright/test";

for (const [engine, browserType] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  for (const width of [1440, 834, 440]) {
    test(`${engine} menu is reachable below the top edge and never overlaps intake at ${width}px`, async ({ baseURL }, info) => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ baseURL, viewport: { width, height: 900 } });
        await page.goto("/?view=referrals&screen=packet");
        const handle = page.getByRole("button", { name: "Show app navigation", exact: true });
        const menu = page.locator("#pipeline-app-navigation");
        const header = page.getByTestId("workspace-folder-header");
        const canvas = page.locator('[data-guide-target="packet-workspace"]');
        await expect(page.getByTestId("intake-client-folder")).toBeVisible();
        await expect(handle).toHaveAttribute("aria-expanded", "false");
        await expect(menu).toHaveAttribute("inert", "");
        const bounds = (await handle.boundingBox())!;
        // The lower half of the full-size handle must work, including narrow desktop panes.
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 34);
        await expect(handle).toHaveAttribute("aria-expanded", "true");
        await expect(menu).toHaveCSS("opacity", "1");
        let menuBounds = (await menu.boundingBox())!;
        expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(menuBounds.y + menuBounds.height);
        const home = page.getByRole("button", { name: "Pipeline home", exact: true });
        await expect.poll(() => home.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
        const homeBounds = (await home.boundingBox())!;
        await page.screenshot({ path: info.outputPath(`intake-menu-${width}.png`) });
        await page.mouse.move(homeBounds.x + homeBounds.width / 2, homeBounds.y + homeBounds.height / 2);
        await expect(handle).toHaveAttribute("aria-expanded", "true");
        await page.mouse.move(width - 20, 400);
        await expect(handle).toHaveAttribute("aria-expanded", "false");
        await expect(menu).toHaveCSS("opacity", "0");
        await canvas.evaluate((el) => { el.scrollTop = 350; });
        await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
        await handle.focus();
        await expect(handle).toHaveAttribute("aria-expanded", "true");
        menuBounds = (await menu.boundingBox())!;
        expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(menuBounds.y + menuBounds.height);
        await handle.press("Escape");
        await expect(handle).toHaveAttribute("aria-expanded", "false");
        await expect(menu).toHaveAttribute("inert", "");
        const edge = page.locator("[data-assessment-nav-edge]");
        expect((await edge.boundingBox())!.height).toBeGreaterThanOrEqual(12);
        await edge.hover({ position: { x: width / 2, y: 8 } });
        await expect(handle).toHaveAttribute("aria-expanded", "true");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally { await browser.close(); }
    });
  }

  test(`${engine} touch menu opens on tap and closes outside without hiding the intake header`, async ({ baseURL }) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await page.goto("/?view=referrals&screen=packet");
      const handle = page.getByRole("button", { name: "Show app navigation", exact: true });
      const menu = page.locator("#pipeline-app-navigation");
      await expect(page.getByTestId("intake-client-folder")).toBeVisible();
      await handle.tap();
      await expect(handle).toHaveAttribute("aria-expanded", "true");
      const bounds = (await menu.boundingBox())!;
      expect((await page.getByTestId("workspace-folder-header").boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
      await page.touchscreen.tap(380, bounds.y + bounds.height + 160);
      await expect(handle).toHaveAttribute("aria-expanded", "false");
      await expect(menu).toHaveAttribute("inert", "");
    } finally { await browser.close(); }
  });
}
