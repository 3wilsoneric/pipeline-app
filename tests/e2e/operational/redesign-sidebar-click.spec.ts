import { expect, test } from "@playwright/test";
import { actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test("redesign app sidebar opens only from its arrow", async ({ browser, baseURL }) => {
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
      await rail.getByRole("button", { name: "Open calendar", exact: true }).hover();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await rail.getByRole("button", { name: "Open calendar", exact: true }).focus();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
      await expand.click();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "true");
      await rail.getByRole("button", { name: "Collapse navigation", exact: true }).click();
      await expect(rail).toHaveAttribute("data-sidebar-expanded", "false");
    }
  } finally {
    await context.close();
  }
});
