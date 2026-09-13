import { expect, test } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`client folders keep legible tabs, fitted spacing and profile navigation with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const profileKey = reducedMotion === "no-preference" ? "current-card-fixture" : undefined;
    const clients = [
      { ...clientDirectoryFixture.clients[0], profile_key: profileKey },
      { ...clientDirectoryFixture.clients[0], profile_key: profileKey ? "current-card-long-name" : undefined, canonical_client_id: "card-long-name", display_name: "Christopher Montgomery-Worthington", current_community: "JC Wallace House", community_names: ["JC Wallace House"] },
      { ...clientDirectoryFixture.clients[0], profile_key: profileKey ? "current-card-missing-fields" : undefined, canonical_client_id: "card-missing-fields", display_name: "Taylor Example", unit: null, admit_date: null, care_level: null },
    ];
    await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
    await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
      ...clientDirectoryFixture, clients, total: clients.length, next_cursor: null,
    } }));
    await page.goto("/?screen=profiles");
    const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
    const tab = card.locator(":scope > strong");
    const body = card.locator(":scope > span");
    await expect(card).toBeVisible();
    const cards = page.getByRole("button", { name: /^Open profile for / });
    await expect(cards).toHaveCount(3);
    await expect(card.getByText("0 documents", { exact: true })).toHaveCount(profileKey ? 0 : 1);

    for (const width of [1920, 1440, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card.locator("strong")).toHaveCSS("font-size", "16px");
      await expect(card.locator("strong")).toHaveCSS("font-weight", "700");
      await expect(card.getByText("Community", { exact: true })).toHaveCSS("font-size", "10px");
      await expect(card.getByText("Community", { exact: true })).toHaveCSS("font-weight", "700");
      await expect(card.getByText("Level 2", { exact: true })).toHaveCSS("font-size", "14px");
      await expect(card.getByText("Level 2", { exact: true })).toHaveCSS("font-weight", "600");
      const chartLabel = card.getByText("Client chart", { exact: true });
      await expect(chartLabel).toHaveCSS("font-weight", "800");
      await expect(chartLabel).toHaveCSS("border-left-width", "3px");
      await expect(body.locator(":scope > span > span").first()).toHaveCSS("background-color", "rgb(241, 247, 243)");
      await expect(body).not.toHaveCSS("box-shadow", "none");
      await expect(tab).toHaveCSS("background-color", "rgb(237, 228, 208)");
      await expect(body).toHaveCSS("background-color", "rgb(237, 228, 208)");
      const tabBounds = await tab.boundingBox();
      const label = tab.locator(":scope > span");
      await expect(label).toHaveCSS("background-color", "rgb(255, 255, 255)");
      const labelBounds = await label.boundingBox();
      expect(labelBounds!.width).toBeLessThan(tabBounds!.width);
      expect(labelBounds!.height).toBeLessThan(tabBounds!.height);
      const bodyBounds = await body.boundingBox();
      expect(tabBounds!.y + tabBounds!.height - bodyBounds!.y).toBe(1);
      expect(tabBounds!.width).toBeLessThan(bodyBounds!.width);
      const grid = page.getByRole("list");
      await expect(grid).toHaveCSS("column-gap", "32px");
      await expect(grid).toHaveCSS("row-gap", width >= 1024 ? "40px" : "32px");
      const firstBounds = await cards.nth(0).boundingBox();
      const nextBounds = await cards.nth(1).boundingBox();
      if (width >= 1024) expect(nextBounds!.x - firstBounds!.x - firstBounds!.width).toBe(32);
      else expect(nextBounds!.x).toBe(firstBounds!.x);
      if (width === 1440) expect(firstBounds!.x).toBe(32);
      for (const bounds of await cards.evaluateAll((nodes) => nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: node.clientWidth, contentWidth: node.scrollWidth };
      }))) {
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width);
      }
      const missing = page.getByRole("button", { name: "Open profile for Taylor Example", exact: true });
      await expect(missing.getByText("—", { exact: true })).toHaveCount(3);
      const longName = page.getByRole("button", { name: "Open profile for Christopher Montgomery-Worthington", exact: true }).locator("strong");
      expect(await longName.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
      await expect(longName).toHaveCSS("text-overflow", "clip");
      if (reducedMotion === "no-preference") await page.screenshot({ path: testInfo.outputPath(`client-cards-${width}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const resting = await card.boundingBox();
    await card.hover();
    await expect(body).toHaveCSS("border-color", "rgb(164, 147, 109)");
    expect(await card.boundingBox()).toEqual(resting);
    await page.mouse.down();
    await expect(tab).toHaveCSS("background-color", "rgb(229, 216, 187)");
    await expect(body).toHaveCSS("background-color", "rgb(229, 216, 187)");
    await expect(card).toHaveCSS("background-image", "none");
    expect(await card.boundingBox()).toEqual(resting);
    if (reducedMotion === "reduce") await expect(card).toHaveCSS("transition-property", "none");
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await card.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(card).toBeFocused();
    await expect(card).toHaveCSS("outline-width", "2px");
    await expect(card.locator("button, a, input, select")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`screen=profile&clientId=${profileKey ?? "client-sanitized-100"}`));
    await expect(page.getByRole("main", { name: "Client profile for Avery Example" })).toBeVisible();
  });
}
