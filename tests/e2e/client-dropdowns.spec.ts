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
  await expect(page.getByText("Riley Perez", { exact: true })).toBeVisible();
}

async function checkStyledMenus(page: Page, testInfo: TestInfo) {
  const menus = ["Filter profiles by community", "Filter profiles by admission date", "Sort clients"];
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
      if (name === menus[0]) await page.screenshot({ path: testInfo.outputPath(`community-menu-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(false);
      await expect(select).toBeFocused();
    }
    const community = page.getByLabel(menus[0]);
    await community.click();
    await community.getByRole("option", { name: "JC Wallace House", exact: true }).click();
    await expect(community).toHaveValue("JC Wallace House");
    await expect(page.getByText("1 matching", { exact: true })).toBeVisible();
    await expect(page.getByText("Oscar Martin", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
  }
}

test("styles each native Clients menu and keeps open options inside the viewport", async ({ page }, testInfo) => {
  await openClients(page);
  await checkStyledMenus(page, testInfo);
});

async function checkNativeFallback(page: Page) {
  const community = page.getByLabel("Filter profiles by community");
  await expect(community).toHaveCSS("appearance", "none");
  await community.selectOption("JC Wallace House");
  await expect(community).toHaveValue("JC Wallace House");
  await expect(page.getByText("1 matching", { exact: true })).toBeVisible();
  await expect(page.getByText("Oscar Martin", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(community).toHaveValue("");
  await expect(page.getByText("Riley Perez", { exact: true })).toBeVisible();
  await community.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Filter profiles by admission date")).toBeFocused();
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

test("preserves native keyboard selection, cancellation and outside dismissal", async ({ page }) => {
  await openClients(page);
  const community = page.getByLabel("Filter profiles by community");
  await community.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(community).toHaveValue("A & A Health Services San Pablo");
  await expect(page.getByText("1 matching", { exact: true })).toBeVisible();
  await community.press("Space");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(community).toHaveValue("A & A Health Services San Pablo");
  await expect(community).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Filter profiles by admission date")).toBeFocused();
  await community.click();
  await page.mouse.click(1, 1);
  await expect.poll(() => community.evaluate((element) => element.matches(":open"))).toBe(false);
  await expect(community).toHaveValue("A & A Health Services San Pablo");
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
  const kind = page.getByLabel("Filter calendar by event type");
  await checkSharedPicker(page, kind, 36);
  await kind.click();
  await kind.getByRole("option", { name: "Follow-ups", exact: true }).click();
  await expect(kind).toHaveValue("follow_up");
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
