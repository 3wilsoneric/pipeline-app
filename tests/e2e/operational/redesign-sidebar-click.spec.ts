import { expect, test } from "@playwright/test";
import { actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test("app navigation shows destinations without a reveal step or hover layout changes", async ({ browser, baseURL }) => {
  const { page, context } = await actorPage(browser, "admin", requireOperationalBaseURL(baseURL));
  try {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "App navigation", exact: true });
    for (const width of [1440, 834]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(rail.locator("[data-navigation-toggle]")).toHaveCount(0);
      const panel = page.locator("#pipeline-app-navigation");
      await expect(panel).toHaveCSS("width", "104px");
      const content = page.locator(".pipeline-surfaces main").first();
      const before = (await content.boundingBox())!;
      const calendar = rail.getByRole("button", { name: "Open calendar", exact: true });
      await expect(calendar.getByText("Calendar", { exact: true })).toBeVisible();
      await calendar.hover();
      await calendar.focus();
      expect((await content.boundingBox())!.x).toBe(before.x);
      await calendar.press("Enter");
      await expect(page).toHaveURL(/screen=calendar/);
      await expect(calendar).toHaveAttribute("aria-current", "page");
      const home = rail.getByRole("button", { name: "Pipeline home", exact: true });
      await expect(home.getByText("Home", { exact: true })).toBeVisible();
      await home.click();
      await expect(home).toHaveAttribute("aria-current", "page");
    }
  } finally {
    await context.close();
  }
});
