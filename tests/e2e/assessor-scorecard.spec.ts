import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { PipelineDelegation } from "@/lib/auth/pipeline-auth";

const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", name: "Eric", roles: ["admin"] };
const keys = ["interviews", "confirmed", "clients", "fields", "uploads", "handoffs", "resends", "sendIssues", "assigned", "overdue", "gaps"];
const people = Array.from({ length: 8 }, (_, index) => ({
  id: `synthetic-${index}`, name: index === 0 ? "Alexandria Montgomery-Washington" : `Synthetic Assessor ${index + 1}`, active: index !== 7,
  evidence: Object.fromEntries(keys.map((key, metric) => [key, Array.from({ length: index === 0 ? 3 : (index + metric) % 6 }, (_, item) => ({
    key: `${key}-${item}`, referralId: item + 1, client: item === 0 ? "Synthetic Client With A Long Full Name" : `Synthetic Client ${item + 1}`, community: "Santa Clarita", at: "2026-11-12T20:00:00Z", detail: key === "gaps" ? "Record referring county" : `${key} recorded`,
  }))])), interviewSpanHours: index === 7 ? null : 2.5, interviewSpanSamples: 3, activeDays: 6,
  usage: { interactions: 200 - index * 20, activeMinutes: 60, days: 4 },
}));
const snapshot = { period: "30d", since: "2026-10-15T07:00:00Z", through: "2026-11-13T20:00:00Z", usageSince: "2026-11-12T20:00:00Z", people, unattributedEvents: 2, unassignedWorkspaces: 1, unassignedGapItems: 4 };

for (const width of [1440, 834, 390]) test(`scorecard sorting, evidence, keyboard and readable layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: owner } }));
  const periods: string[] = [];
  await page.route("**/api/operations/assessor-scorecard?*", route => {
    const period = new URL(route.request().url()).searchParams.get("period")!;
    periods.push(period);
    return route.fulfill({ json: { ...snapshot, period, since: period === "launch" ? "2026-09-18T07:00:00Z" : period === "week" ? "2026-11-09T08:00:00Z" : snapshot.since } });
  });
  await page.goto("/?screen=operations");
  const opener = page.getByRole("navigation", { name: "Reports", exact: true }).getByRole("link", { name: "Assessor scorecard", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(opener).toHaveAttribute("aria-current", "page");
  const report = page.getByRole("main", { name: "Assessor scorecard", exact: true });
  await expect(report.getByText("Alexandria Montgomery-Washington", { exact: true })).toBeVisible();
  await page.setViewportSize({ width, height: 960 });
  await report.getByRole("combobox", { name: "Sort by" }).selectOption("name");
  await expect(report.locator("tbody tr").first()).toContainText("Alexandria Montgomery-Washington");
  await expect(report.locator("tbody tr")).toHaveCount(8);
  expect(await report.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  for (const row of await report.locator("tbody tr").all()) expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await report.getByRole("combobox", { name: "Period", exact: true }).selectOption("launch");
  await expect.poll(() => periods.at(-1)).toBe("launch");
  await report.getByRole("button", { name: "Alexandria Montgomery-Washington: 3 open completion items" }).click();
  const breakdown = report.getByLabel("Alexandria Montgomery-Washington breakdown", { exact: true });
  await expect(breakdown).toBeFocused();
  await expect(breakdown.getByText("Record referring county").first()).toBeVisible();
  await expect(breakdown.getByRole("link", { name: "Synthetic Client With A Long Full Name" })).toHaveAttribute("href", /referralId=1&workspaceStage=chart/);
  await breakdown.getByRole("button", { name: "3 Charts confirmed" }).click();
  await expect(breakdown.getByRole("heading", { name: "Charts confirmed" })).toBeVisible();
  await page.screenshot({ path: `.data/scorecard-detail-${width}.png` });
  await report.getByText("How this is counted", { exact: true }).click();
  await expect(report.getByText(/Notes have no complete author history/)).toBeVisible();
  await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: (target: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe.run('[data-testid="operations-workspace"]');
    return result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  });
  expect(violations).toEqual([]);
  await report.evaluate(node => node.scrollTop = 0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `.data/scorecard-${width}.png` });
  await page.reload();
  await expect(report.getByRole("heading", { name: "Assessor scorecard", exact: true })).toBeVisible();
  await expect(opener).toHaveAttribute("aria-current", "page");
});

test("failure is retryable, zero results are honest and other users cannot see the entry", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: owner } }));
  let failed = true;
  await page.route("**/api/operations/assessor-scorecard?*", route => route.fulfill(failed ? { status: 503, json: { error: "Unavailable" } } : { json: { ...snapshot, people: [], usageSince: null, unattributedEvents: 0, unassignedWorkspaces: 0, unassignedGapItems: 0 } }));
  await page.goto("/?screen=operations&report=assessor_scorecard");
  await expect(page.getByRole("main", { name: "Assessor scorecard", exact: true }).getByRole("alert")).toContainText("Scorecard unavailable");
  failed = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No assessor records in this period.")).toBeVisible();
  await expect(page.getByText(/Historical click and active-time data are unavailable/)).toBeVisible();
  let privateRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/operations/assessor-scorecard") privateRequests += 1; });
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { ...owner, id: "b72c34f0-0ee8-4ab4-8359-81c8f7b0d3b2", email: "sandeep@aaahealthservices.com" } } }));
  await page.reload();
  await expect(page).toHaveURL(/\?screen=operations$/);
  await expect(page.getByRole("heading", { name: "Admissions & census", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Assessor scorecard", exact: true })).toHaveCount(0);
  expect(privateRequests).toBe(0);
});

test("PDF export keeps selected filters, downloads once and can retry a failure", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: owner } }));
  let fail = true;
  const exports: URL[] = [];
  await page.route("**/api/operations/assessor-scorecard?*", route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("format") !== "pdf") return route.fulfill({ json: snapshot });
    exports.push(url);
    return route.fulfill(fail ? { status: 503, json: { error: "Unavailable" } } : { contentType: "application/pdf", headers: { "content-disposition": 'attachment; filename="pipeline-assessor-scorecard-launch.pdf"' }, body: Buffer.from("%PDF-Synthetic download") });
  });
  await page.goto("/?screen=operations&report=assessor_scorecard");
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("launch");
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("name");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const exportError = page.getByRole("alert").filter({ hasText: "PDF unavailable" });
  await expect(exportError).toBeVisible();
  fail = false;
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("pipeline-assessor-scorecard-launch.pdf");
  expect(readFileSync((await download.path())!, "utf8")).toBe("%PDF-Synthetic download");
  expect(exports).toHaveLength(2);
  for (const url of exports) { expect(url.searchParams.get("period")).toBe("launch"); expect(url.searchParams.get("sort")).toBe("name"); }
  await expect(exportError).toHaveCount(0);
});

test("Reports tabs keep history and delegated sessions cannot read the scorecard", async ({ page }) => {
  let delegated = false;
  const delegation: PipelineDelegation = {
    sessionId: "synthetic-session", initiatedBy: { id: "synthetic-admin", name: "Synthetic Admin", email: "admin@example.invalid" },
    target: { ...owner, roles: ["admin"], identityStatus: "entra_linked" }, reason: "Synthetic access check",
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(),
  };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: { ...owner, ...(delegated ? { delegation } : {}) } } }));
  let reads = 0;
  await page.route("**/api/operations/assessor-scorecard?*", route => { reads += 1; return route.fulfill({ json: snapshot }); });
  await page.goto("/?screen=operations");
  const tabs = page.getByRole("navigation", { name: "Reports", exact: true });
  await tabs.getByRole("link", { name: "Assessor scorecard" }).click();
  await expect(page.getByRole("main", { name: "Assessor scorecard" }).getByRole("table")).toBeVisible();
  await tabs.getByRole("link", { name: "Admissions & census", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admissions & census" })).toBeVisible();
  await page.goBack();
  await expect(tabs.getByRole("link", { name: "Assessor scorecard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main", { name: "Assessor scorecard" }).getByRole("table")).toBeVisible();
  await page.goForward();
  await expect(tabs.getByRole("link", { name: "Admissions & census", exact: true })).toHaveAttribute("aria-current", "page");
  const before = reads;
  delegated = true;
  await page.goto("/?screen=operations&report=assessor_scorecard");
  await expect(page).toHaveURL(/\?screen=operations$/);
  await expect(tabs.getByRole("link", { name: "Assessor scorecard" })).toHaveCount(0);
  expect(reads).toBe(before);
});

test("usage captures native keyboard activation once, omits content, and stops after account changes", async ({ page }) => {
  await page.clock.install();
  const posted: { sessionId: string; samples: { minute: string; interactions: number }[] }[] = [];
  let reject = false;
  await page.route("**/api/me/usage", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, accountId: owner.id } });
    expect(route.request().headers()["x-pipeline-usage-account"]).toBe(owner.id);
    posted.push(route.request().postDataJSON());
    return route.fulfill({ status: reject ? 409 : 204 });
  });
  await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/me/usage") && response.request().method() === "GET"), page.goto("/")]);
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const tray = document.createElement("div");
    tray.id = "usage-fixture";
    tray.style.cssText = "position:fixed;top:0;left:0;z-index:99999;background:white";
    tray.innerHTML = '<button type="button">Usage fixture action</button><input type="text" aria-label="Usage fixture input" />';
    document.body.append(tray);
  });
  const button = page.getByRole("button", { name: "Usage fixture action" });
  await button.click();
  await page.keyboard.press("Space");
  await page.getByLabel("Usage fixture input").fill("never collect this client text");
  await button.dispatchEvent("click");
  await page.clock.fastForward(30_000);
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].samples.reduce((sum, item) => sum + item.interactions, 0)).toBe(2);
  expect(JSON.stringify(posted)).not.toMatch(/never collect|Usage fixture|referral|url/);
  reject = true;
  await button.click();
  await page.clock.fastForward(30_000);
  await expect.poll(() => posted.length).toBe(2);
  await button.click();
  await page.clock.fastForward(30_000);
  expect(posted.length).toBe(2);
});
