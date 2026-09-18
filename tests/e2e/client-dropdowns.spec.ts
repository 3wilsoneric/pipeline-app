import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";

async function openClients(page: Page) {
  const communities = ["A & A Health Services San Pablo", "AHS Turlock OP LLC", "JC Wallace House"];
  const clients = communities.map((community, index) => ({
    ...clientDirectoryFixture.clients[0],
    canonical_client_id: `dropdown-${index}`,
    display_name: ["Riley Perez", "Taylor Chen", "Oscar Martin"][index],
    community_names: [community],
    current_community: community,
    current_resident: true,
    admit_date: "2026-07-08",
  }));
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
    ...clientDirectoryFixture, clients, total: clients.length, next_cursor: null, data_as_of: "2026-08-07",
  } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open client profiles" }).click();
  await expect(page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true })).toBeVisible();
}

async function checkStyledMenus(page: Page, testInfo: TestInfo) {
  const menus = ["Filter profiles by admission date", "Sort clients"];
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of menus) {
      const select = page.getByLabel(name);
      await expect(select).toHaveCSS("appearance", "base-select");
      await select.click();
      await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(true);
      expect(await select.evaluate((element) => getComputedStyle(element, "::picker(select)").backgroundColor)).toBe("rgb(255, 255, 255)");
      const bounds = await select.locator("option").evaluateAll((options) => options.map((option) => {
        const rect = option.getBoundingClientRect();
        return { left: rect.left, right: rect.right, height: rect.height };
      }));
      for (const option of bounds) {
        expect(option.left).toBeGreaterThanOrEqual(0);
        expect(option.right).toBeLessThanOrEqual(width);
        expect(option.height).toBeGreaterThanOrEqual(42);
      }
      if (name === menus[0]) await page.screenshot({ path: testInfo.outputPath(`admission-menu-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(false);
      await expect(select).toBeFocused();
    }
    await expect(page.getByLabel("Filter profiles by community")).toHaveCount(0);
    const cabinet = page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true });
    await cabinet.click();
    const drawer = page.getByRole("dialog", { name: "JC Wallace House file cabinet", exact: true });
    await expect(drawer.getByRole("list", { name: "JC Wallace House clients", exact: true })).toContainText("Oscar Martin");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(cabinet).toBeFocused();
  }
}

test("styles each native Clients menu and keeps open options inside the viewport", async ({ page }, testInfo) => {
  await openClients(page);
  await checkStyledMenus(page, testInfo);
});

async function checkNativeFallback(page: Page) {
  const admitted = page.getByLabel("Filter profiles by admission date");
  await expect(admitted).toHaveCSS("appearance", "none");
  await admitted.selectOption("last_3_months");
  await expect(admitted).toHaveValue("last_3_months");
  await expect(page.getByText("3 matching", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true })).toContainText("1 client");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(admitted).toHaveValue("any");
  await expect(page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true })).toBeVisible();
  await admitted.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Sort clients")).toBeFocused();
}

for (const browserName of ["webkit", "firefox"] as const) {
  test(`preserves the Clients picker in ${browserName}`, async ({ playwright, baseURL }, testInfo) => {
    const browser = await playwright[browserName].launch();
    try {
      const page = await browser.newPage({ baseURL });
      await openClients(page);
      const styled = await page.evaluate(() => CSS.supports("appearance", "base-select") && CSS.supports("selector(select::picker(select))"));
      if (styled) await checkStyledMenus(page, testInfo);
      else await checkNativeFallback(page);
    } finally {
      await browser.close();
    }
  });
}

test("compact cabinets expand into one file window and return focus on close", async ({ page }, testInfo) => {
  await openClients(page);
  await expect(page.getByLabel("Filter profiles by community")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  const cabinets = page.getByRole("group", { name: "Community file cabinets" }).getByRole("button");
  const bounds = await cabinets.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { y: r.y, width: r.width, height: r.height }; }));
  expect(bounds.every((r) => r.y === bounds[0].y && r.width <= 220 && r.height <= 220)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("cabinet-row.png") });
  const cabinet = page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true });
  await cabinet.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "JC Wallace House file cabinet", exact: true });
  await expect(drawer.getByRole("button", { name: "Open profile for Oscar Martin", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Open profile for Riley Perez", exact: true })).toHaveCount(0);
  await expect.poll(() => drawer.evaluate((node) => node.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  expect((await drawer.boundingBox())!.width).toBeGreaterThan(1000);
  await page.screenshot({ path: testInfo.outputPath("cabinet-open.png") });
  await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
  await expect(drawer.getByTestId("client-chart-thumbnail")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(cabinet).toBeFocused();
  await expect(page.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await cabinet.click();
  expect(await drawer.evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Close jc wallace house file cabinet", exact: true }).click();
  await expect(cabinet).toBeFocused();
});

async function checkSharedPicker(page: Page, select: Locator, height: number) {
  await expect(select).toHaveCSS("appearance", "base-select");
  await expect(select).toHaveCSS("height", `${height}px`);
  await expect(select).toHaveCSS("align-items", "center");
  const value = await select.inputValue();
  await select.click();
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(true);
  const picker = await select.evaluate((element) => {
    const style = getComputedStyle(element, "::picker(select)");
    return { background: style.backgroundColor, radius: style.borderRadius, width: Number.parseFloat(style.width) };
  });
  expect(picker.background).toBe("rgb(255, 255, 255)");
  expect(picker.radius).toBe("2px");
  expect(picker.width).toBeGreaterThanOrEqual((await select.boundingBox())!.width - 2);
  for (const option of await select.locator("option").evaluateAll((options) => options.map((option) => {
    const rect = option.getBoundingClientRect();
    return { left: rect.left, right: rect.right, height: rect.height };
  }))) {
    expect(option.left).toBeGreaterThanOrEqual(0);
    expect(option.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(option.height).toBeGreaterThanOrEqual(42);
  }
  await page.keyboard.press("Escape");
  await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(false);
  await expect(select).toHaveValue(value);
  await expect(select).toBeFocused();
}

test("shares Clients picker styling with compact Reports and Calendar controls", async ({ page }, testInfo) => {
  await page.goto("/?screen=operations");
  await expect(page.getByLabel("Report clients")).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["Report", "Report clients", "Report period", "Report community", "Report county"]) {
      await checkSharedPicker(page, page.getByLabel(name, { exact: true }), 36);
    }
    await page.getByLabel("Report", { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`reports-picker-${width}.png`) });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto("/?screen=calendar");
  await page.getByRole("button", { name: "Show calendar filters" }).click();
  const assessor = page.getByLabel("Filter calendar by assessor");
  const option = assessor.locator('option:not([value=""])').first();
  await expect(option).toHaveAttribute("value", /.+/);
  const value = (await option.getAttribute("value"))!;
  await checkSharedPicker(page, assessor, 36);
  await assessor.click();
  await option.click();
  await expect(assessor).toHaveValue(value);
});

test("styles intake pickers and contact suggestions without changing selection behavior", async ({ page }, testInfo) => {
  const organization = "Sample Referral Hospital";
  await page.route("**/api/contacts?**", (route) => route.fulfill({ json: { contacts: [{
    id: "dropdown-contact", firstName: "Example", lastName: "Scheduler", organization,
  }] } }));
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await page.getByRole("region", { name: "Document checklist" }).locator("summary").click();
  await checkSharedPicker(page, page.getByLabel("Initial document type"), 32);
  await checkSharedPicker(page, page.getByLabel("Conservatorship", { exact: true }), 32);
  const source = page.getByRole("combobox", { name: "Referral facility / source", exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await source.fill("Sample");
    const menu = page.getByRole("listbox", { name: "Referral facility / source suggestions" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(menu).toHaveCSS("border-radius", "2px");
    const option = menu.getByRole("option");
    await source.press("ArrowDown");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await expect(option).toHaveCSS("background-color", "rgb(239, 250, 245)");
    const bounds = (await option.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(42);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`contact-suggestions-${width}.png`) });
    await source.press("Enter");
    await expect(source).toHaveValue(organization);
    await expect(menu).toHaveCount(0);
  }
});
