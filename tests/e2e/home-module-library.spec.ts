import { expect, test, type Page } from "@playwright/test";

const defaults = ["search", "recent-work", "current-work", "new-assignments", "upcoming-assessments"];

async function moduleOrder(page: Page) {
  return page.locator("[data-home-module]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-home-module")));
}

async function mockLayout(page: Page, moduleIds: string[] = defaults) {
  let layout = { schema: 2, module_ids: moduleIds, locked: true };
  const writes: typeof layout[] = [];
  await page.route("**/api/me/home-layout", async (route) => {
    if (route.request().method() === "PUT") {
      layout = route.request().postDataJSON().layout;
      writes.push(layout);
    }
    await route.fulfill({ json: { layout } });
  });
  return writes;
}

test("removes search and recent work, adds a batch once, and keeps canceled selections out of Home", async ({ page }) => {
  const writes = await mockLayout(page);
  await page.goto("/?editHome=1");
  await page.getByRole("button", { name: "Remove Search from Home", exact: true }).click();
  await page.getByRole("button", { name: "Remove Recent work from Home", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Home module library" });
  await library.getByRole("checkbox", { name: "Search", exact: true }).check();
  await library.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  await expect(library.getByRole("checkbox", { name: "Search", exact: true })).not.toBeChecked();
  await library.getByRole("checkbox", { name: "Search", exact: true }).check();
  await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
  await library.getByRole("button", { name: "Add 2 modules", exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].module_ids).toEqual(["current-work", "new-assignments", "upcoming-assessments", "search", "recent-work"]);
  await page.reload();
  await expect.poll(() => moduleOrder(page)).toEqual(writes[2].module_ids);
});

test("keeps header search usable without the Home search module", async ({ page }) => {
  await mockLayout(page, ["current-work"]);
  await page.goto("/");
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
  await expect(page.getByRole("region", { name: "Search Pipeline", exact: true })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search Pipeline", exact: true });
  await expect(search).toBeVisible();
  await expect(search.getByRole("textbox", { name: "Search or ask" })).toBeFocused();
  await search.getByRole("textbox", { name: "Search or ask" }).fill("calendar");
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
});

for (const width of [390, 834, 1440]) {
  test(`module library fits ${width}px, keeps background controls inert, and restores focus`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLayout(page, ["current-work"]);
    await page.goto("/?editHome=1");
    const add = page.getByRole("button", { name: "Add module", exact: true });
    await add.click();
    const library = page.getByRole("dialog", { name: "Home module library" });
    await expect(library).toBeVisible();
    await expect(library.getByRole("button", { name: "Close home module library" })).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Search Pipeline", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/editHome=1/);
    await page.keyboard.press("Shift+Tab");
    // Native dialogs can move focus to browser chrome, but not the inert page.
    expect(await library.evaluate((dialog) => dialog.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(library.getByRole("button", { name: "Close home module library" })).toBeFocused();
    await library.getByRole("checkbox", { name: "Search", exact: true }).check();
    await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
    await expect(library.getByRole("button", { name: "Add 2 modules", exact: true })).toBeInViewport();
    expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-library-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(add).toBeFocused();
    await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
  });
}

test("moves Search with the pointer and Recent work with arrow keys", async ({ page }) => {
  await mockLayout(page, ["search", "recent-work", "current-work"]);
  await page.goto("/?editHome=1");
  const handle = page.getByRole("button", { name: "Move Search", exact: true });
  const start = await handle.boundingBox();
  const target = await page.locator('[data-home-module="recent-work"]').boundingBox();
  expect(start).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => moduleOrder(page)).toEqual(["recent-work", "search", "current-work"]);
  await page.getByRole("button", { name: "Move Recent work", exact: true }).press("ArrowDown");
  await expect.poll(() => moduleOrder(page)).toEqual(["search", "recent-work", "current-work"]);
});

test("an empty Home can add modules again or restore defaults", async ({ page }) => {
  await mockLayout(page, []);
  await page.goto("/?editHome=1");
  await page.getByRole("button", { name: "Open module library" }).click();
  const library = page.getByRole("dialog", { name: "Home module library" });
  await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
  await library.getByRole("button", { name: "Add 1 module", exact: true }).click();
  await expect.poll(() => moduleOrder(page)).toEqual(["recent-work"]);
  await expect(page.getByRole("region", { name: "Continue working" })).toBeVisible();
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  await library.getByRole("button", { name: "Restore defaults" }).click();
  await expect.poll(() => moduleOrder(page)).toEqual(defaults);
});

test("layout loading cannot overwrite an edit made against an unfinished read", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/me/home-layout", async (route) => {
    await gate;
    await route.fulfill({ json: { layout: { schema: 2, module_ids: ["recent-work"], locked: true } } });
  });
  await page.goto("/?editHome=1");
  await expect(page.getByRole("button", { name: "Add module", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Remove .* from Home$/ })).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Add module", exact: true })).toBeEnabled();
  await expect.poll(() => moduleOrder(page)).toEqual(["recent-work"]);
});

test("the layout API migrates legacy order, preserves removals, and scopes settings to the signed-in user", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const save = (layout: unknown) => request.put("/api/me/home-layout", { headers: { origin }, data: { layout } });
  const legacy = await save({ schema: 1, module_ids: ["scheduling-queue"], locked: true });
  expect(legacy.status()).toBe(200);
  expect((await legacy.json()).layout).toEqual({ schema: 2, module_ids: ["search", "recent-work", "scheduling-queue"], locked: true });
  expect((await save({ schema: 2, module_ids: ["recent-work"], locked: true })).status()).toBe(200);
  expect((await (await request.get("/api/me/home-layout")).json()).layout.module_ids).toEqual(["recent-work"]);
  expect((await save({ schema: 2, module_ids: ["search", "search"], locked: true })).status()).toBe(400);
  const delegated = await request.post("/api/auth/assessor-session", { headers: { origin }, data: { target_principal_id: "provisional:allo:annette" } });
  expect(delegated.status()).toBe(200);
  expect((await (await request.get("/api/me/home-layout")).json()).layout.module_ids).toEqual(defaults);
  await request.delete("/api/auth/assessor-session", { headers: { origin } });
  expect((await (await request.get("/api/me/home-layout")).json()).layout.module_ids).toEqual(["recent-work"]);
  expect((await save({ schema: 2, module_ids: defaults, locked: true })).status()).toBe(200);
});
