import { expect, test, type Page } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

async function directory(page: Page, count = 3) {
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
    ...clientDirectoryFixture,
    clients: ["Avery Example", "Blair Example", "Casey Example"].slice(0, count).map((name, index) => ({
      ...clientDirectoryFixture.clients[0], display_name: name,
      canonical_client_id: `stack-client-${index}`, profile_key: `stack-client-${index}`,
    })),
    total: count, next_cursor: null,
  } }));
  await page.goto("/?screen=profiles");
  await expect(page.getByRole("button", { name: "Open profile for Avery Example", exact: true })).toBeVisible();
  return page.getByRole("region", { name: "Client list", exact: true }).getByRole("button", { name: /^Open profile for/ });
}

test("client folders retain their dimensions and fan like Home for pointer and keyboard", async ({ page }, testInfo) => {
  const cards = await directory(page);
  const first = cards.nth(0);
  const second = cards.nth(1);
  const last = cards.nth(2);
  const gap = async () => (await second.boundingBox())!.y - (await first.boundingBox())!.y;
  await page.mouse.move(1, 1);
  await expect.poll(gap).toBe(86);
  const original = (await first.boundingBox())!;
  expect(original.height).toBe((await last.boundingBox())!.height);
  expect(original.width).toBe((await last.boundingBox())!.width);
  await page.screenshot({ path: testInfo.outputPath("clients-stacked.png") });

  await first.locator(":scope > strong").hover();
  await expect.poll(gap).toBe(188);
  expect((await first.boundingBox())!.height).toBe(original.height);
  await expect(first.locator(":scope > span > span > span").first()).toHaveCSS("opacity", "1");
  await expect(first.getByText("Date of birth", { exact: true }).locator("..")).toHaveCSS("opacity", "0");
  await page.screenshot({ path: testInfo.outputPath("clients-fanned.png") });

  await page.mouse.move(1, 1);
  await expect.poll(gap).toBe(86);
  // Opening a lower folder must not move its label away from the pointer.
  const tab = second.locator(":scope > strong");
  const tabBox = (await tab.boundingBox())!;
  await page.mouse.move(tabBox.x + 20, tabBox.y + 15);
  await expect.poll(async () => (await tab.boundingBox())!.y).toBe(tabBox.y);
  await page.mouse.move(1, 1);
  await first.focus();
  await expect.poll(gap).toBe(188);
  await page.keyboard.press("Tab");
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/screen=profile&clientId=stack-client-1/);
  await expect(page.getByTestId("client-profile-folder")).toBeVisible();
});

test("list view and reduced motion retain their behavior", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const cards = await directory(page);
  await expect(cards.first().locator("..")).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
  const first = (await cards.first().boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  await expect(page.getByTestId("client-chart-thumbnail")).toHaveCount(3);
  await cards.nth(1).click();
  await expect(page).toHaveURL(/screen=profile&clientId=stack-client-1/);
});

for (const width of [390, 1100]) {
  test(`touch at ${width}px keeps the complete folders and one-tap opening`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, hasTouch: true });
    try {
      const page = await context.newPage();
      const cards = await directory(page);
      const first = (await cards.first().boundingBox())!;
      const second = (await cards.nth(1).boundingBox())!;
      expect(second.y - first.y - first.height).toBe(24);
      await expect(cards.first().locator(":scope > span > span > span").first()).toHaveCSS("opacity", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`clients-touch-${width}.png`) });
      await cards.first().tap();
      await expect(page).toHaveURL(/screen=profile&clientId=stack-client-0/);
    } finally { await context.close(); }
  });
}
