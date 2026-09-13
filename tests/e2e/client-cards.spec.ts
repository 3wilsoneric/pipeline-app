import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`client folders keep legible tabs, fitted spacing and profile navigation with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    const profileKey = reducedMotion === "no-preference" ? "current-card-fixture" : undefined;
    const summaryFields = { date_of_birth: "1985-01-02", age: 41, payor: "Example Plan", primary_diagnosis: "Documented diagnosis from the current census", physician: "Example Clinician", diet: "Regular", length_of_stay_days: 209 };
    const clients = [
      { ...clientDirectoryFixture.clients[0], ...summaryFields, profile_key: profileKey },
      { ...clientDirectoryFixture.clients[0], ...summaryFields, primary_diagnosis: "Documented diagnosis ".repeat(12), physician: "Example clinician with a longer practice name", diet: "A documented diet description that wraps without truncating", profile_key: profileKey ? "current-card-long-name" : undefined, canonical_client_id: "card-long-name", display_name: "Christopher Montgomery-Worthington", current_community: "JC Wallace House", community_names: ["JC Wallace House"] },
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
    for (const value of ["Jan 2, 1985", "41", "R-100", "Example Plan", summaryFields.primary_diagnosis, "Example Clinician", "Regular", "209 days"]) {
      await expect(card.getByText(value, { exact: true })).toBeVisible();
    }

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
      await expect(grid).toHaveCSS("column-gap", "24px");
      await expect(grid).toHaveCSS("row-gap", "24px");
      const firstBounds = await cards.nth(0).boundingBox();
      const nextBounds = await cards.nth(1).boundingBox();
      const gridBounds = await grid.boundingBox();
      expect(firstBounds!.width).toBe(gridBounds!.width);
      expect(nextBounds!.x).toBe(firstBounds!.x);
      expect(nextBounds!.y - firstBounds!.y - firstBounds!.height).toBe(24);
      const summary = body.locator(":scope > span > span").nth(1);
      expect(await summary.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(width >= 768 ? 4 : 2);
      await expect(summary.locator(":scope > span")).toHaveCount(12);
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
      await expect(missing.getByText("—", { exact: true })).toHaveCount(10);
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
    await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show clients as a list", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByTestId("client-chart-thumbnail")).toBeVisible();
    await expect(card.locator(":scope > strong")).toHaveCount(0);
    await checkCompactClientRows(page, card, cards, testInfo, reducedMotion === "no-preference");
    await card.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`screen=profile&clientId=${profileKey ?? "client-sanitized-100"}`));
    await expect(page.getByRole("main", { name: "Client profile for Avery Example" })).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(page.getByRole("button", { name: "Show clients as a list", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByTestId("client-chart-thumbnail")).toBeVisible();
  });
}

async function checkCompactClientRows(page: Page, card: Locator, cards: Locator, testInfo: TestInfo, captureScreenshots: boolean) {
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const rowBounds = await card.boundingBox();
    expect(rowBounds!.height).toBeLessThan(width < 1024 ? 180 : 100);
    for (const bounds of await cards.evaluateAll((nodes) => nodes.map((node) => ({ right: node.getBoundingClientRect().right, width: node.clientWidth, contentWidth: node.scrollWidth })))) {
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.contentWidth).toBeLessThanOrEqual(bounds.width);
    }
    const longName = cards.nth(1).getByText("Christopher Montgomery-Worthington", { exact: true });
    expect(await longName.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (captureScreenshots) await page.screenshot({ path: testInfo.outputPath(`client-list-${width}.png`), fullPage: true });
  }
}

test("client summaries show zero age and zero days as values, not missing data", async ({ page }) => {
  const client = { ...clientDirectoryFixture.clients[0], age: 0, length_of_stay_days: 0 };
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: { ...clientDirectoryFixture, clients: [client] } }));
  await page.goto("/?screen=profiles");
  const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
  await expect(card.getByText("0", { exact: true })).toBeVisible();
  await expect(card.getByText("0 days", { exact: true })).toBeVisible();
});

test("client view switches retain loaded results, filters, sorting and the display limit", async ({ page }) => {
  let directoryRequests = 0;
  const clients = Array.from({ length: 105 }, (_, index) => ({
    ...clientDirectoryFixture.clients[0],
    profile_key: `list-client-${index}`,
    canonical_client_id: `list-client-${index}`,
    display_name: index === 104 ? "Avery Example" : "Taylor Example",
  }));
  await page.route("**/api/profiles/directory**", (route) => {
    directoryRequests += 1;
    const query = new URL(route.request().url()).searchParams.get("q") ?? "";
    const matches = clients.filter((client) => client.display_name.includes(query));
    return route.fulfill({ json: { ...clientDirectoryFixture, clients: matches, total: matches.length, next_cursor: null } });
  });
  await page.goto("/?screen=profiles");
  const cards = page.getByRole("button", { name: /^Open profile for / });
  const listToggle = page.getByRole("button", { name: "Show clients as a list", exact: true });
  const cardsToggle = page.getByRole("button", { name: "Show clients as cards", exact: true });
  await expect(cards).toHaveCount(100);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(cards).toHaveCount(105);
  const requestsBeforeToggle = directoryRequests;
  await listToggle.click();
  await expect(cards).toHaveCount(105);
  await cardsToggle.click();
  await expect(cards).toHaveCount(105);
  expect(directoryRequests).toBe(requestsBeforeToggle);
  await page.getByLabel("Filter profiles by community").selectOption({ index: 1 });
  await page.getByLabel("Sort clients", { exact: true }).selectOption("recent_admission");
  const community = await page.getByLabel("Filter profiles by community").inputValue();
  await listToggle.click();
  await expect(page.getByLabel("Filter profiles by community")).toHaveValue(community);
  await expect(page.getByLabel("Sort clients", { exact: true })).toHaveValue("recent_admission");
  await page.getByRole("textbox", { name: "Search clients", exact: true }).fill("Avery Example");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleName("Open profile for Avery Example");
  const requestsAfterSearch = directoryRequests;
  await cardsToggle.click();
  await expect(page.getByRole("textbox", { name: "Search clients", exact: true })).toHaveValue("Avery Example");
  await expect(cards).toHaveCount(1);
  expect(directoryRequests).toBe(requestsAfterSearch);
  await listToggle.click();
  await page.reload();
  await expect(listToggle).toHaveAttribute("aria-pressed", "true");
  await expect(cards.first().getByTestId("client-chart-thumbnail")).toBeVisible();
});

test("client view toggle works when preference storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "pipeline:client-directory-layout") throw new DOMException("Blocked", "SecurityError");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "pipeline:client-directory-layout") throw new DOMException("Blocked", "SecurityError");
      return setItem.call(this, key, value);
    };
  });
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: clientDirectoryFixture }));
  await page.goto("/?screen=profiles");
  await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
  await expect(page.getByTestId("client-chart-thumbnail").first()).toBeVisible();
  await page.getByRole("button", { name: "Show clients as cards", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open profile for / }).first().locator("strong")).toBeVisible();
});
