import { chromium, webkit, expect, test, type Page } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";
import { randomUUID } from "node:crypto";

async function mockDirectory(page: Page, selectedId = 900016) {
  const files = Array.from({ length: 125 }, (_, index) => ({
    id: index === 16 ? selectedId : 900000 + index,
    name: index === 124 ? "Zoe Faraway" : index === 16 ? "Avery Selected" : index === 50 ? "Avery Secondpage" : "Avery Example",
    community: index % 2 ? "Turlock" : "San Pablo", owner: index % 2 ? "Blair Assessor" : "Alex Assessor",
    date: index === 124 ? "2026-08-01" : "2026-09-18", createdAt: "2026-09-18T00:00:00Z",
    stage: index === 124 ? "Declined" : "Packet Review", workflowStatus: index === 124 ? "declined" : "ready_to_schedule",
    workspaceStatus: index === 124 ? "historical" : "active", priority: "standard", source: "Synthetic",
    requirements: [], documentName: "", documentStatus: "Missing", note: "",
  }));
  const requests: URL[] = [];
  await page.route(/\/api\/referrals(?:\/directory)?\?/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const query = url.searchParams.get("q")?.toLowerCase() ?? "";
    const matches = files.filter((file) => `${file.name} ${file.community} ${file.owner}`.toLowerCase().includes(query));
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    await route.fulfill({ json: {
      referrals: matches.slice(offset, offset + 50), total: matches.length,
      next_cursor: offset + 50 < matches.length ? String(offset + 50) : undefined,
      revision: 1, progress: {}, file_total: 0,
      facets: { communities: [{ value: "San Pablo", count: 63 }, { value: "Turlock", count: 62 }],
        owners: [{ value: "Alex Assessor", count: 63 }, { value: "Blair Assessor", count: 62 }],
        stages: [], counties: [], priorities: [], tags: [], months: [] },
    } });
  });
  return requests;
}

async function openWorkspaces(page: Page) {
  if (await page.locator("[data-phone-header]").count()) await page.getByRole("button", { name: /^Open page menu/ }).click();
  await page.getByRole("button", { name: "Open referrals", exact: true }).click();
  await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
}

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  for (const width of [1440, 834, 390, 320]) {
    test(`${name} uses one workspace directory at ${width}px`, async ({ baseURL }, info) => {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const requests = await mockDirectory(page);
        await page.goto("/");
        await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "All workspaces", exact: true })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`home-${name}-${width}.png`) });
        await openWorkspaces(page);
        await expect(page).toHaveURL(/view=referrals/);
        await expect(page.getByRole("dialog", { name: "All workspaces", exact: true })).toHaveCount(0);
        const directory = page.getByRole("main", { name: "Referral workspaces" });
        await expect(directory.getByRole("button", { name: /Open .* referral workspace/ })).toHaveCount(50);
        await directory.getByRole("button", { name: "Next", exact: true }).click();
        await expect(directory.getByRole("button", { name: "Open Avery Secondpage referral workspace", exact: true })).toBeVisible();
        await directory.getByRole("searchbox", { name: "Search all workspaces" }).fill("Zoe");
        await expect(directory.getByRole("button", { name: "Open Zoe Faraway referral workspace", exact: true })).toBeVisible();
        expect(requests.at(-1)?.searchParams.get("workspace")).toBe("all");
        expect(requests.at(-1)?.searchParams.get("scope")).toBe("team");
        expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`directory-${name}-${width}.png`) });
        await page.goBack();
        await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
        await expect(page.getByRole("dialog", { name: "All workspaces", exact: true })).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally { await browser.close(); }
    });
  }
}

test("old browser links use the directory and opening a file adds no extra back strip", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Navigation ${randomUUID()}`, owner: "" });
  await mockDirectory(page, referral.id);
  await page.goto("/?browse=workspaces");
  await expect(page).toHaveURL(/\?view=referrals$/);
  const search = page.getByRole("searchbox", { name: "Search all workspaces" });
  await search.fill("Avery Selected");
  await page.getByRole("button", { name: "Open Avery Selected referral workspace", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}`));
  await expect(page.getByTestId("workspace-identity-title")).toContainText("Synthetic Navigation");
  expect(new URL(page.url()).searchParams.has("fromBrowser")).toBe(false);
  await expect(page.getByRole("button", { name: /Back to all workspaces/ })).toHaveCount(0);
  await page.goBack();
  await expect(search).toHaveValue("Avery Selected");
  await expect(page.getByRole("button", { name: "Open Avery Selected referral workspace", exact: true })).toBeVisible();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart&fromBrowser=1`);
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("fromBrowser")).toBe(false);
  expect(new URL(page.url()).searchParams.get("workspaceStage")).toBe("chart");
  await expect(page.getByRole("button", { name: /Back to all workspaces/ })).toHaveCount(0);
});

test("directory failures remain retryable instead of showing a false empty state", async ({ page }) => {
  await mockDirectory(page);
  let unavailable = true;
  await page.route("**/api/referrals/directory?**", (route) => unavailable
    ? route.fulfill({ status: 503, json: { error: "Synthetic temporary failure" } }) : route.fallback());
  await page.goto("/?browse=workspaces");
  const directory = page.getByRole("main", { name: "Referral workspaces" });
  await expect(directory.getByRole("alert")).toContainText("Synthetic temporary failure");
  unavailable = false;
  await directory.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(directory.getByRole("button", { name: /Open .* referral workspace/ })).toHaveCount(50);
  await directory.getByRole("searchbox", { name: "Search all workspaces" }).fill("NoSuchSyntheticClient");
  await expect(directory.getByText("No workspaces match this search", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("personal-board.png") });
});
