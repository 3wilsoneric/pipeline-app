import { chromium, expect, test, webkit } from "@playwright/test";

for (const [engine, browserType] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  for (const width of [1440, 834, 437, 320]) {
    test(`${engine} persistent sidebar works across pages at ${width}px`, async ({ baseURL }, info) => {
      const browser = await browserType.launch();
      try {
        const height = width === 437 ? 536 : 900;
        const page = await browser.newPage({ baseURL, viewport: { width, height }, hasTouch: width < 960 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const rail = page.getByRole("complementary", { name: "App navigation", exact: true });
        const panel = page.locator("#pipeline-app-navigation");
        const content = page.locator(".pipeline-surfaces > div > main");
        for (const path of ["/", "/?screen=calendar", "/?screen=profiles", "/?screen=operations", "/?view=referrals&screen=packet", "/settings", "/training"]) {
          await page.goto(path);
          await expect(rail).toBeVisible();
          await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
          await expect(page.getByRole("button", { name: "Show app navigation" })).toHaveCount(0);
          await expect(rail.getByRole("button", { name: "Pipeline home", exact: true }).locator("img")).toBeVisible();
          await expect(rail.getByRole("button", { name: "Pipeline home", exact: true }).getByText("Pipeline", { exact: true })).toBeHidden();
          const bounds = (await panel.boundingBox())!;
          expect(bounds.width).toBe(width < 960 ? 56 : 68);
          const pageBounds = (await content.boundingBox())!;
          expect(pageBounds.x).toBeGreaterThanOrEqual(bounds.x + bounds.width);
          expect(pageBounds.y).toBe(bounds.y);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await rail.getByRole("button", { name: "Open calendar", exact: true }).hover();
          await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
        }

        await page.goto("/?screen=calendar");
        const collapsedContent = (await content.boundingBox())!;
        await rail.getByRole("button", { name: "Expand navigation", exact: true }).click();
        await expect(rail).toHaveAttribute("data-sidebar-expanded", "true");
        await expect(rail.getByRole("button", { name: "Open calendar", exact: true }).getByText("Calendar", { exact: true })).toBeVisible();
        await expect(panel).toHaveCSS("width", "216px");
        const brand = rail.getByRole("button", { name: "Pipeline home", exact: true });
        await expect(brand).toHaveAttribute("title", "Pipeline — Alamo Health Management");
        await expect(brand.getByText("Pipeline", { exact: true })).toHaveCSS("color", "rgb(40, 97, 79)");
        await expect(brand.getByText(/Alamo Health/)).toBeVisible();
        await expect(brand).toContainText("Management");
        expect(await brand.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await brand.screenshot({ path: info.outputPath(`pipeline-alamo-brand-${width}.png`) });
        expect((await content.boundingBox())!.x).toBe(width < 960 ? collapsedContent.x : 216);
        for (const name of ["Open referrals", "Open calendar", "Open client profiles", "Open reports", "Create new referral"]) {
          const bounds = (await rail.getByRole("button", { name, exact: true }).boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.width).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: info.outputPath(`sidebar-expanded-${width}.png`) });
        await rail.getByRole("button", { name: "Collapse navigation", exact: true }).press("Escape");
        await expect(rail.getByRole("button", { name: "Expand navigation", exact: true })).toBeFocused();
        await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
        await rail.getByRole("button", { name: "Expand navigation", exact: true }).click();
        if (width < 960) {
          await page.getByRole("button", { name: "Close navigation", exact: true }).click({ position: { x: width - 10, y: 180 } });
          await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
          await rail.getByRole("button", { name: "Expand navigation", exact: true }).click();
        }
        await rail.getByRole("button", { name: "Open client profiles", exact: true }).click();
        await expect(page).toHaveURL(/screen=profiles/);
        await expect(rail).toHaveAttribute("data-sidebar-expanded", width < 960 ? "false" : "true");
        await rail.getByRole("button", { name: /^Open profile menu for/ }).click();
        const profile = page.getByRole("dialog", { name: "Profile settings", exact: true });
        await expect(profile).toBeInViewport();
        const profileBounds = (await profile.boundingBox())!;
        expect(profileBounds.x).toBeGreaterThanOrEqual(0);
        expect(profileBounds.x + profileBounds.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
        await expect(profile).toBeHidden();
        await expect(rail).toBeVisible();
        await page.screenshot({ path: info.outputPath(`sidebar-collapsed-${width}.png`) });
      } finally { await browser.close(); }
    });
  }
}
