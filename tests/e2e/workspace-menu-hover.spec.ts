import { chromium, expect, test, webkit, type Page } from "@playwright/test";

for (const [engine, browserType] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  for (const width of [1440, 834]) {
    const sidebarTest = test.extend<{ sidebarPage: Page }>({
      sidebarPage: async ({ baseURL }, providePage) => {
        const browser = await browserType.launch();
        const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 960, deviceScaleFactor: 2, reducedMotion: "reduce" });
        try { await providePage(await context.newPage()); }
        finally { await context.close(); await browser.close(); }
      },
    });
    sidebarTest.describe(`${engine} fixed navigation at ${width}px`, () => {
      for (const path of ["/", "/?screen=calendar", "/?screen=profiles", "/?screen=operations", "/?view=referrals&screen=packet", "/settings"]) {
        sidebarTest(`visible destinations and stable layout on ${path}`, async ({ sidebarPage: page }) => {
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
          const rail = page.getByRole("complementary", { name: "App navigation", exact: true });
          const panel = page.locator("#pipeline-app-navigation");
          const content = page.locator(".pipeline-surfaces main").first();
          await expect(rail).toBeVisible();
          await expect(rail.locator("[data-navigation-toggle]")).toHaveCount(0);
          const home = rail.getByRole("button", { name: "Pipeline home", exact: true });
          await expect(home.locator('img[src$="/brand/pipeline-mark.svg"]')).toBeVisible();
          await expect(home.getByText("Home", { exact: true })).toBeVisible();
          await expect(home).toHaveAttribute("title", "Pipeline — Alamo Health Management");
          const bounds = (await panel.boundingBox())!;
          expect(bounds.width).toBe(104);
          const pageBounds = (await content.boundingBox())!;
          expect(pageBounds.x).toBeGreaterThanOrEqual(bounds.x + bounds.width);
          expect(pageBounds.y).toBe(bounds.y);
          for (const [name, label] of [["Open referrals", "Workspaces"], ["Open calendar", "Calendar"], ["Open reports", "Reports"], ["Create new referral", "New Intake"]]) {
            const item = rail.getByRole("button", { name, exact: true });
            await expect(item.getByText(label, { exact: true })).toBeVisible();
            const box = (await item.boundingBox())!;
            expect(box.height).toBeGreaterThanOrEqual(48);
            expect(box.width).toBeGreaterThanOrEqual(48);
            expect(await item.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
          }
          await rail.getByRole("button", { name: "Open calendar", exact: true }).hover();
          await expect(panel).toHaveCSS("width", "104px");
          expect((await content.boundingBox())!.x).toBe(pageBounds.x);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        });
      }
      sidebarTest("keyboard destinations and profile stay available without expanding", async ({ sidebarPage: page }) => {
        await page.goto("/?screen=calendar");
        const rail = page.getByRole("complementary", { name: "App navigation", exact: true });
        const calendar = rail.getByRole("button", { name: "Open calendar", exact: true });
        await expect(calendar).toHaveAttribute("aria-current", "page");
        const workspaces = rail.getByRole("button", { name: "Open referrals", exact: true });
        await workspaces.focus();
        await workspaces.press("Enter");
        await expect(page).toHaveURL(/view=referrals/);
        await expect(workspaces).toHaveAttribute("aria-current", "page");
        const trigger = rail.getByRole("button", { name: /^Open profile menu for/ });
        await trigger.click();
        const profile = page.getByRole("dialog", { name: "Profile settings", exact: true });
        await expect(profile).toBeInViewport();
        const bounds = (await profile.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(104);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await expect(profile.getByRole("button", { name: "Open guided tutorials" })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(profile).toBeHidden();
        await expect(trigger).toBeFocused();
        await rail.getByRole("button", { name: "Pipeline home", exact: true }).click();
        await expect(rail.getByRole("button", { name: "Pipeline home", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(rail).toBeVisible();
      });
    });
  }
}
