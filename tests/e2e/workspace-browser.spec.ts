import { devices, expect, test, webkit, type Page } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";
import { randomUUID } from "node:crypto";

type File = { id: number; name: string; community: string; owner: string; date: string; createdAt: string; stage: string; workflowStatus: string; workspaceStatus: string };
async function mockDirectory(page: Page, selectedId?: number) {
  const files: File[] = Array.from({ length: 125 }, (_, index) => ({
    id: index === 16 && selectedId ? selectedId : 900000 + index,
    name: index === 124 ? "Zoe Faraway" : `Avery Example ${String(index).padStart(3, "0")}`,
    community: index % 2 ? "Turlock" : "San Pablo", owner: index % 2 ? "Vince Ceja" : "Annette Everhart",
    date: "2026-09-18", createdAt: "2026-09-18T00:00:00Z", stage: index === 124 ? "Declined" : "Packet Review",
    workflowStatus: index === 124 ? "declined" : "ready_to_schedule", workspaceStatus: index === 124 ? "historical" : "active",
  }));
  const requests: URL[] = [];
  await page.route("**/api/referrals/facets?**", (route) => route.fulfill({ json: { facets: {
    communities: [{ value: "San Pablo", count: 63 }, { value: "Turlock", count: 62 }],
    owners: [{ value: "Vince Ceja", count: 62 }, { value: "Annette Everhart", count: 63 }],
    stages: [{ value: "Packet Review", count: 124 }, { value: "Declined", count: 1 }],
    counties: [], priorities: [], tags: [], months: [],
  } } }));
  await page.route("**/api/referrals?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("projection") !== "summary") return route.continue();
    requests.push(url);
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    let matches = files.filter((file) => `${file.name} ${file.community} ${file.owner}`.toLowerCase().includes(q));
    for (const [param, field] of [["community", "community"], ["owner", "owner"], ["stage", "stage"]] as const) {
      const value = url.searchParams.get(param);
      if (value) matches = matches.filter((file) => file[field] === value);
    }
    const initial = url.searchParams.get("initial");
    if (initial) matches = matches.filter((file) => file.name.startsWith(initial));
    if (url.searchParams.get("sort") === "client_asc") matches.sort((a, b) => a.name.localeCompare(b.name));
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    await route.fulfill({ json: { referrals: matches.slice(offset, offset + 50), total: matches.length, next_cursor: offset + 50 < matches.length ? String(offset + 50) : undefined } });
  });
  return { files, requests };
}

for (const width of [1440, 834, 390, 320]) {
  test(`workspace index fits and keeps search, scroll and focus at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Index ${randomUUID()}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
    await mockDirectory(page, referral.id);
    await page.goto("/");
    await page.getByRole("button", { name: "All workspaces", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "All workspaces", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("searchbox", { name: "Find any workspace" }).fill("Avery");
    await expect(dialog.getByRole("status").filter({ hasText: "124 workspaces" })).toBeVisible();
    const file = dialog.getByRole("button", { name: "Open workspace for Avery Example 016", exact: true });
    await file.scrollIntoViewIfNeeded();
    const scroller = dialog.locator("[data-workspace-browser-scroll]");
    const scrollBefore = await scroller.evaluate((element) => element.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);
    await file.click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}`));
    await page.getByRole("button", { name: "Back to all workspaces", exact: false }).click();
    await expect(dialog).toBeVisible();
    await expect(file).toBeFocused();
    await expect(dialog.getByRole("searchbox", { name: "Find any workspace" })).toHaveValue("Avery");
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollBefore, 0);
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`workspace-index-${width}.png`) });
    await file.click();
    await expect(dialog).toBeHidden();
    await page.goBack();
    await expect(file).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "All workspaces", exact: true })).toBeVisible();
  });
}

test("searches the full collection, pages on scroll, and applies real alphabet and filters", async ({ page }, testInfo) => {
  const { requests } = await mockDirectory(page);
  await page.goto("/?browse=workspaces");
  const dialog = page.getByRole("dialog", { name: "All workspaces" });
  await expect(dialog.getByRole("listitem")).toHaveCount(50);
  await dialog.locator("[data-workspace-browser-scroll]").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByRole("listitem")).toHaveCount(100);
  await dialog.getByRole("searchbox", { name: "Find any workspace" }).fill("Zoe");
  await expect(dialog.getByRole("button", { name: "Open workspace for Zoe Faraway" })).toBeVisible();
  await expect(dialog.getByText("Declined · Historical", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("workspace")).toBe("all");
  expect(requests.at(-1)?.searchParams.get("scope")).toBe("team");
  await dialog.getByRole("button", { name: "Clear search & filters", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Sort all workspaces" }).selectOption("client_asc");
  await dialog.getByRole("button", { name: "Names beginning with Z", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "Open workspace for Zoe Faraway" })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("initial")).toBe("Z");
  await dialog.getByRole("button", { name: "All names", exact: true }).click();
  await dialog.getByRole("button", { name: "Filters", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Workspace community" }).selectOption("Turlock");
  await dialog.getByRole("combobox", { name: "Workspace assessor" }).selectOption("Vince Ceja");
  await expect(dialog.getByRole("status").filter({ hasText: "62 workspaces" })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("community")).toBe("Turlock");
  expect(requests.at(-1)?.searchParams.get("owner")).toBe("Vince Ceja");
  await page.screenshot({ path: testInfo.outputPath("workspace-index-filters.png") });
});

test("distinguishes loading failure from no matches, retries, and offers Trash", async ({ page }) => {
  await mockDirectory(page);
  let unavailable = true;
  await page.route("**/api/referrals?**", (route) => new URL(route.request().url()).searchParams.get("projection") === "summary" && unavailable
    ? route.fulfill({ status: 503, json: { error: "Synthetic temporary failure" } }) : route.fallback());
  await page.goto("/?browse=workspaces");
  const dialog = page.getByRole("dialog", { name: "All workspaces" });
  await expect(dialog.getByText("Workspaces could not be loaded. Try again.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "No matching workspaces" })).toHaveCount(0);
  unavailable = false;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(50);
  await dialog.getByRole("searchbox", { name: "Find any workspace" }).fill("NoSuchSyntheticClient");
  await expect(dialog.getByRole("heading", { name: "No matching workspaces" })).toBeVisible();
  await dialog.getByRole("button", { name: "Check Trash", exact: true }).click();
  await expect(page).toHaveURL(/screen=trash/);
  await expect(dialog).toBeHidden();
});

test("personal Board keeps all active files and collapses finished outcomes", async ({ page }, testInfo) => {
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const item = { referral_id: 710001, client_name: "Avery Active", community: "Turlock", workflow_status: "ready_to_schedule", flow_state: "ready_to_schedule", outcome_state: "pending", owner: "Playwright QA", completion_pct: 30, missing_document_count: 0, received_at: "2026-09-18", next_action: "Schedule assessment", location: { view: "intake" } };
    const items = Array.from({ length: 7 }, (_, index) => ({ ...item, referral_id: item.referral_id + index, client_name: `Avery Active ${index}` }));
    payload.scope = "personal";
    payload.workflow.active_total = 7;
    payload.workflow.active_items = items;
    payload.workflow.board_items = [...items, { ...item, referral_id: 720000, client_name: "Blair Finished", flow_state: "complete", workflow_status: "admitted", outcome_state: "accepted" }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/");
  const board = page.getByRole("region", { name: "Current work board" });
  await expect(board.getByRole("button", { name: /^Open Avery Active/ })).toHaveCount(7);
  await expect(board.getByRole("button", { name: "Open Blair Finished" })).toBeHidden();
  await board.locator("summary").click();
  await expect(board.getByRole("button", { name: "Blair Finished Turlock Admitted" })).toBeVisible();
  await expect(page.getByText("Your referrals · newest received first")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("personal-board.png") });
});

for (const device of ["iPhone 13", "iPad Mini"]) {
  test(`Safari workspace browser stays usable on ${device}`, async ({ baseURL }, testInfo) => {
    const browser = await webkit.launch();
    const context = await browser.newContext({ ...devices[device], baseURL });
    const page = await context.newPage();
    try {
      await mockDirectory(page);
      await page.goto("/");
      await page.getByRole("button", { name: "All workspaces", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "All workspaces" });
      await expect(dialog.getByRole("listitem")).toHaveCount(50);
      await dialog.getByRole("combobox", { name: "Sort all workspaces" }).selectOption("client_asc");
      await dialog.getByRole("button", { name: "Names beginning with Z", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Open workspace for Zoe Faraway" })).toBeVisible();
      await dialog.getByRole("button", { name: /Filters/, exact: false }).click();
      await expect(dialog.getByRole("combobox", { name: "Workspace stage" })).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath("safari-workspace-browser.png") });
      await dialog.getByRole("button", { name: "Close all workspaces", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("button", { name: "All workspaces", exact: true })).toBeFocused();
    } finally { await context.close(); await browser.close(); }
  });
}
