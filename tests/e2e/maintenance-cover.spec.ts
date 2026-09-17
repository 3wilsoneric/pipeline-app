import { expect, test } from "@playwright/test";

test("maintenance covers every page and cannot be dismissed or navigated behind", async ({ page }) => {
  test.skip(process.env.PIPELINE_MAINTENANCE_MODE !== "true", "Only runs with the temporary maintenance cover enabled.");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const path of ["/", "/note-lab/practice"]) {
    await page.goto(path);
    const cover = page.getByRole("dialog", { name: "Temporarily disabled", exact: true });
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(page.locator("[inert][aria-hidden=true]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cover).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[inert]")))).toBe(false);
    await page.mouse.click(20, 20);
    await expect(cover).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const cover = page.getByRole("dialog", { name: "Temporarily disabled", exact: true });
  await expect(cover.getByRole("heading", { name: "Temporarily disabled" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("maintenance-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.screenshot({ path: test.info().outputPath("maintenance-desktop.png") });
});
