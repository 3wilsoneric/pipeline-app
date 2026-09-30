import { expect, test } from "@playwright/test";
import { actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test("redesign app sidebar opens only from its top edge arrow without shifting navigation", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_DESIGN_V2 !== "true", "The click-only sidebar belongs to the redesign.");
  const { page, context } = await actorPage(browser, "admin", requireOperationalBaseURL(baseURL));
  try {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "App navigation", exact: true });
    for (const width of [1440, 834]) {
      await page.setViewportSize({ width, height: 900 });
      const expand = rail.getByRole("button", { name: "Expand navigation", exact: true });
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await expect(expand).toBeVisible();
      const panel = page.locator("#pipeline-app-navigation");
      await expect(panel).toHaveCSS("width", width < 960 ? "56px" : "68px");
      const assertTopArrow = async () => {
        const arrowBounds = (await rail.locator("[data-navigation-toggle]").boundingBox())!;
        const panelBounds = (await panel.boundingBox())!;
        const homeBounds = (await rail.getByRole("button", { name: "Pipeline home", exact: true }).boundingBox())!;
        expect(arrowBounds.y - panelBounds.y).toBe(8);
        expect(arrowBounds.x + arrowBounds.width / 2).toBe(panelBounds.x + panelBounds.width);
        expect(homeBounds.y - panelBounds.y).toBe(16);
        expect(arrowBounds.width).toBeGreaterThanOrEqual(44);
        expect(arrowBounds.height).toBeGreaterThanOrEqual(44);
      };
      await assertTopArrow();
      await rail.getByRole("button", { name: "Open calendar", exact: true }).hover();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await rail.getByRole("button", { name: "Open calendar", exact: true }).focus();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await expand.click();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "true");
      await expect(panel).toHaveCSS("width", "216px");
      await assertTopArrow();
      await rail.getByRole("button", { name: "Collapse navigation", exact: true }).click();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await expand.press("Enter");
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "true");
      await rail.getByRole("button", { name: "Collapse navigation", exact: true }).press("Escape");
      await expect(expand).toBeFocused();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await page.screenshot({ path: test.info().outputPath(`sidebar-top-arrow-${width}.png`) });
    }
  } finally {
    await context.close();
  }
});
