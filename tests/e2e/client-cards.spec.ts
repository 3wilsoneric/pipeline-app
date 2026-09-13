import { expect, test } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`client cards retain readable framing and profile navigation with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const profileKey = reducedMotion === "reduce" ? "current-card-fixture" : undefined;
    const clients = [
      { ...clientDirectoryFixture.clients[0], profile_key: profileKey },
      { ...clientDirectoryFixture.clients[0], canonical_client_id: "card-long-name", display_name: "Christopher Montgomery-Worthington", current_community: "JC Wallace House", community_names: ["JC Wallace House"] },
      { ...clientDirectoryFixture.clients[0], canonical_client_id: "card-missing-fields", display_name: "Taylor Example", unit: null, admit_date: null, care_level: null },
    ];
    await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
    await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
      ...clientDirectoryFixture, clients, total: clients.length, next_cursor: null,
    } }));
    await page.goto("/?screen=profiles");
    const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
    await expect(card).toBeVisible();
    const cards = page.getByRole("button", { name: /^Open profile for / });
    await expect(cards).toHaveCount(3);

    for (const width of [1440, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card.locator("strong")).toHaveCSS("font-size", "18px");
      await expect(card.locator("strong")).toHaveCSS("font-weight", "700");
      await expect(card.getByText("Community", { exact: true })).toHaveCSS("font-size", "10px");
      await expect(card.getByText("Level 2", { exact: true })).toHaveCSS("font-size", "12px");
      await expect(card).not.toHaveCSS("box-shadow", "none");
      await expect(card).toHaveCSS("border-radius", "0px");
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
      if (reducedMotion === "no-preference") await page.screenshot({ path: testInfo.outputPath(`client-cards-${width}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const resting = await card.boundingBox();
    await card.hover();
    await expect(card).toHaveCSS("border-color", "rgb(139, 180, 165)");
    expect(await card.boundingBox()).toEqual(resting);
    await page.mouse.down();
    await expect(card.locator(":scope > span").first()).toHaveCSS("background-color", "rgb(237, 245, 240)");
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
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`screen=profile&clientId=${profileKey ?? "client-sanitized-100"}`));
    await expect(page.getByRole("main", { name: "Client profile for Avery Example" })).toBeVisible();
  });
}
