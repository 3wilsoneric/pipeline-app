import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

async function openClients(page: Page) {
  const communities = ["A & A Health Services San Pablo", "AHS Turlock OP LLC", "JC Wallace House", "JC Wallace House"];
  const clients = communities.map((community, index) => ({
    ...clientDirectoryFixture.clients[0],
    canonical_client_id: `dropdown-${index}`,
    display_name: ["Riley Perez", "Taylor Chen", "Oscar Martin", "Aaron Hill"][index],
    resident_numbers: [`R-${100 + index}`],
    community_names: [community],
    current_community: community,
    current_resident: true,
    admit_date: index === 3 ? "2020-01-01" : "2026-07-08",
  }));
  await page.route("**/api/profiles/directory**", (route) => {
    const query = (new URL(route.request().url()).searchParams.get("q") ?? "").trim().toLowerCase();
    const matches = clients.filter((client) => [client.display_name, ...client.resident_numbers, client.current_community].some((value) => value.toLowerCase().includes(query)));
    return route.fulfill({ json: {
      ...clientDirectoryFixture, clients: matches, total: matches.length, next_cursor: null, data_as_of: "2026-08-07",
    } });
  });
  await page.goto("/?screen=profiles");
  await expect(page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true })).toBeVisible();
}

async function checkStyledMenus(page: Page, testInfo: TestInfo) {
  const menus = ["Filter profiles by admission date", "Sort clients"];
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("combobox")).toHaveCount(0);
    const cabinet = page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true });
    await cabinet.click();
    const drawer = page.getByRole("region", { name: "JC Wallace House file cabinet", exact: true });
    await expect(drawer.getByRole("region", { name: "Cabinet filters", exact: true }).getByRole("combobox")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of menus) {
      const select = page.getByLabel(name);
      await expect(select).toHaveCSS("appearance", "base-select");
      await select.click();
      await expect.poll(() => select.evaluate((element) => element.matches(":open"))).toBe(true);
      expect(await select.evaluate((element) => getComputedStyle(element, "::picker(select)").backgroundColor)).toBe("rgb(255, 255, 255)");
      expect(await select.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(15);
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
    await expect(drawer.getByRole("list", { name: "JC Wallace House clients", exact: true })).toContainText("Oscar Martin");
    await page.screenshot({ path: testInfo.outputPath(`cabinet-filters-${width}.png`) });
    await drawer.focus();
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
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true }).click();
  const drawer = page.getByRole("region", { name: "JC Wallace House file cabinet", exact: true });
  const admitted = page.getByLabel("Filter profiles by admission date");
  await expect(admitted).toHaveCSS("appearance", "none");
  await admitted.selectOption("last_3_months");
  await expect(admitted).toHaveValue("last_3_months");
  await expect(drawer.getByRole("listitem")).toHaveCount(1);
  await expect(drawer.getByRole("list")).toContainText("Oscar Martin");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(admitted).toHaveValue("any");
  await expect(drawer.getByRole("listitem")).toHaveCount(2);
  await admitted.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Sort clients")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Back to cabinets", exact: true }).click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
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

test("compact cabinets expand across the page body and return focus on close", async ({ page }, testInfo) => {
  await openClients(page);
  await expect(page.getByLabel("Filter profiles by community")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Client files", exact: true })).toBeVisible();
  const cabinets = page.getByRole("group", { name: "Community file cabinets" }).getByRole("button");
  const bounds = await cabinets.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  expect(bounds.every((r) => r.x === bounds[0].x && r.width === bounds[0].width && r.height >= 72 && r.height <= 120)).toBe(true);
  expect(bounds[1].y).toBeGreaterThanOrEqual(bounds[0].y + bounds[0].height);
  expect(bounds[2].y).toBeGreaterThanOrEqual(bounds[1].y + bounds[1].height);
  await page.screenshot({ path: testInfo.outputPath("cabinet-stack.png") });
  const cabinet = page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true });
  await cabinet.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("region", { name: "JC Wallace House file cabinet", exact: true });
  await expect(drawer.getByRole("button", { name: "Open profile for Oscar Martin", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Open profile for Riley Perez", exact: true })).toHaveCount(0);
  await expect.poll(() => drawer.evaluate((node) => node.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  expect(await drawer.boundingBox()).toEqual(await page.getByRole("main", { name: "Client profiles" }).boundingBox());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Pipeline home", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cabinet-open.png") });
  await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
  await expect(drawer.getByTestId("client-chart-thumbnail")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(cabinet).toBeFocused();
  await expect(page.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await cabinet.click();
  expect(await drawer.evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Back to cabinets", exact: true }).click();
  await expect(cabinet).toBeFocused();

  await cabinet.click();
  const search = drawer.getByRole("textbox", { name: "Search this cabinet", exact: true });
  const searchCabinet = (value: string) => Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/profiles/directory") && new URL(response.url()).searchParams.get("q") === value),
    search.fill(value),
  ]);
  await searchCabinet("oscar");
  await expect(drawer.getByRole("button", { name: "Open profile for Oscar Martin", exact: true })).toBeVisible();
  await searchCabinet("r-102");
  await expect(drawer.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  await expect(drawer.getByText("No clients match the current search and filters in this cabinet.")).toBeVisible();
  await searchCabinet("Riley");
  await expect(drawer.getByText("No clients match the current search and filters in this cabinet.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: "Clear cabinet search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(drawer.getByRole("button", { name: "Open profile for Oscar Martin", exact: true })).toBeVisible();
  await search.fill("Riley");
  await expect(drawer.getByText("No clients match the current search and filters in this cabinet.")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Open profile for/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to cabinets", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search clients", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Search clients", exact: true })).toHaveValue("Riley");
  await expect(page.getByRole("list", { name: "Matching client files" }).getByRole("button", { name: "Open profile for Riley Perez", exact: true })).toBeVisible();
});

test("client name search surfaces files across cabinets and excludes other fields", async ({ page }, testInfo) => {
  await openClients(page);
  const search = page.getByRole("textbox", { name: "Search clients", exact: true });
  const results = page.getByRole("list", { name: "Matching client files", exact: true });
  await expect(search).toHaveAttribute("placeholder", "Search by client name");
  await search.fill("  a  ");
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await expect(results).toContainText("Taylor Chen");
  await expect(results).toContainText("Oscar Martin");
  await expect(results).toContainText("Aaron Hill");
  await expect(page.getByRole("group", { name: "Community file cabinets" })).toHaveCount(0);
  await search.fill("  rIlEy  ");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(results).toContainText("Riley Perez");
  await expect(results).toContainText("A & A Health Services San Pablo");
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(results.getByRole("button")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`name-search-${width}.png`) });
  }
  for (const nonName of ["r-100", "San Pablo"]) {
    await search.fill(nonName);
    await expect(page.getByRole("heading", { name: "No clients match that search." })).toBeVisible();
    await expect(results.getByRole("listitem")).toHaveCount(0);
    await expect(page.getByText("0 matching files", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Clear client search", exact: true }).click();
  await expect(results).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Community file cabinets" }).getByRole("button")).toHaveCount(3);
});

test("name search walks all result pages and opens the matching chart directly", async ({ page }) => {
  await openClients(page);
  await page.route("**/api/profiles/name-match**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  const requestedCursors: Array<string | null> = [];
  await page.route("**/api/profiles/directory**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    requestedCursors.push(cursor);
    const client = {
      ...clientDirectoryFixture.clients[0],
      canonical_client_id: cursor ? "name-match" : "community-match",
      display_name: cursor ? "Riley Perez" : "Taylor Chen",
      current_community: cursor ? "San Pablo" : "Perez House",
      community_names: [cursor ? "San Pablo" : "Perez House"],
    };
    return route.fulfill({ json: {
      ...clientDirectoryFixture, clients: [client], total: 2,
      next_cursor: cursor ? null : "second-page", data_as_of: "2026-08-07",
    } });
  });
  await page.getByRole("textbox", { name: "Search clients", exact: true }).fill("Perez");
  await expect.poll(() => requestedCursors).toEqual([null, "second-page"]);
  const results = page.getByRole("list", { name: "Matching client files" });
  const file = results.getByRole("button", { name: "Open profile for Riley Perez", exact: true });
  await expect(file).toBeVisible();
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("1 matching file", { exact: true })).toBeVisible();
  await file.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/screen=profile&clientId=name-match/);
  await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search clients", exact: true })).toHaveValue("Perez");
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await expect(file).toBeFocused();
});

test("client chart files open in the in-app preview without leaving the profile", async ({ page }) => {
  const document = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Example referral.pdf",
    category: "Referral packet",
    referralId: 1,
    referralName: "Example referral",
    community: "",
    uploadedAt: "2026-09-24T12:00:00Z",
    status: "Uploaded",
    previewStatus: "ready",
    previewUrl: "/api/files/11111111-1111-4111-8111-111111111111/preview",
  };
  await page.route("**/api/profiles/name-match**", (route) => route.fulfill({ json: {
    ...unifiedProfileFixture,
    pipeline: { ...unifiedProfileFixture.pipeline, documents: [document] },
  } }));
  await page.route("**/api/files/11111111-1111-4111-8111-111111111111?**", (route) => route.fulfill({ json: {
    file: { content_type: "application/pdf", category: "referral_packet", byte_size: 100,
      malware_scan_status: "clean", page_count: 1,
      pages: [{ page_number: 1, byte_size: 100, preview_url: document.previewUrl,
        thumbnail_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }],
    },
  } }));
  await page.goto("/?screen=profile&clientId=name-match");
  await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  await page.getByRole("button", { name: "Open Example referral.pdf" }).click();
  await expect(page.getByRole("dialog", { name: "Preview Example referral.pdf" })).toBeVisible();
  await expect(page).toHaveURL(/screen=profile&clientId=name-match/);
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "Open file" }).click();
  await expect(page.getByRole("dialog", { name: "Preview Example referral.pdf" })).toBeVisible();
});

test("cabinet controls stay readable and reachable with long labels on small screens", async ({ page }, testInfo) => {
  await openClients(page);
  for (const width of [834, 390, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.screenshot({ path: testInfo.outputPath(`directory-${width}.png`) });
    await page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true }).click();
    const drawer = page.getByRole("region", { name: "A & A Health Services San Pablo file cabinet", exact: true });
    await expect(drawer.getByRole("heading")).toHaveText("A & A Health Services San Pablo");
    await expect.poll(() => drawer.evaluate((node) => node.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
    const controls = [
      drawer.getByRole("button", { name: "Back to cabinets" }),
      drawer.getByRole("button", { name: "Show clients as cards" }),
      drawer.getByRole("button", { name: "Show clients as a list" }),
      drawer.getByLabel("Search this cabinet"),
      drawer.getByLabel("Filter profiles by admission date"),
      drawer.getByLabel("Sort clients"),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const rect = (await control.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    await expect(drawer.getByRole("button", { name: "Open profile for Riley Perez", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`cabinet-long-label-${width}.png`) });
    await drawer.getByRole("button", { name: "Back to cabinets" }).click();
  }
});

test("filters and sorting belong only to the open cabinet", async ({ page }) => {
  await openClients(page);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  const cabinet = page.getByRole("button", { name: "Open JC Wallace House file cabinet", exact: true });
  await cabinet.click();
  const drawer = page.getByRole("region", { name: "JC Wallace House file cabinet", exact: true });
  const records = drawer.getByRole("list").getByRole("button", { name: /^Open profile for/ });
  await expect(records).toHaveCount(2);
  await expect(records.first()).toHaveAccessibleName("Open profile for Aaron Hill");
  await drawer.getByLabel("Sort clients").selectOption("recent_admission");
  await expect(records.first()).toHaveAccessibleName("Open profile for Oscar Martin");
  await drawer.getByLabel("Filter profiles by admission date").selectOption("last_3_months");
  await expect(records).toHaveCount(1);
  await expect(records.first()).toHaveAccessibleName("Open profile for Oscar Martin");
  await drawer.getByLabel("Filter profiles by admission date").selectOption("missing");
  await expect(records).toHaveCount(0);
  await expect(drawer.getByText("No clients match the current search and filters in this cabinet.")).toBeVisible();
  await drawer.getByRole("button", { name: "Reset filters" }).click();
  await expect(records).toHaveCount(2);
  await expect(records.first()).toHaveAccessibleName("Open profile for Aaron Hill");
  await drawer.getByLabel("Filter profiles by admission date").selectOption("missing");
  await drawer.getByRole("button", { name: "Back to cabinets" }).click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Community file cabinets" }).getByRole("button")).toHaveCount(3);
  await expect(cabinet).toContainText("2 clients");
  await expect(cabinet).toBeFocused();
  await page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true }).click();
  await expect(page.getByLabel("Filter profiles by admission date")).toHaveValue("any");
  await expect(page.getByLabel("Sort clients")).toHaveValue("name");
  await expect(page.getByRole("button", { name: "Open profile for Riley Perez", exact: true })).toBeVisible();
  await expect(page.getByLabel("Filter profiles by community")).toHaveCount(0);
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
  await checkSharedPicker(page, assessor, 44);
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
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles({ name: "picker.pdf", mimeType: "application/pdf", buffer: Buffer.from("Synthetic picker document") });
  const labels = page.getByRole("dialog", { name: "Label your files" });
  await labels.getByRole("combobox").selectOption("face_sheet");
  await expect(labels.getByRole("combobox")).toHaveValue("face_sheet");
  await labels.getByRole("button", { name: "Cancel", exact: true }).click();
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
