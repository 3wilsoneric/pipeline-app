import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { PipelineDelegation } from "@/lib/auth/pipeline-auth";

const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", name: "Eric", roles: ["admin"] };
const keys = ["interviews", "confirmed", "clients", "fields", "uploads", "handoffs", "resends", "sendIssues", "assigned", "overdue", "gaps"];
const people = Array.from({ length: 8 }, (_, index) => ({
  id: `synthetic-${index}`, name: index === 0 ? "Alexandria Montgomery-Washington" : `Synthetic Assessor ${index + 1}`, active: index !== 7,
  evidence: Object.fromEntries(keys.map((key, metric) => [key, Array.from({ length: key === "overdue" ? (index === 0 ? 1 : 0) : index === 0 ? 3 : (index + metric) % 6 }, (_, item) => ({
    key: `${key}-${item}`, referralId: item + 1, client: item === 0 ? "Synthetic Client With A Long Full Name" : `Synthetic Client ${item + 1}`, community: "Santa Clarita", at: "2026-11-12T20:00:00Z", detail: key === "gaps" ? "Record referring county" : `${key} recorded`,
  }))])), interviewSpanHours: index === 7 ? null : 2.5, interviewSpanSamples: 3, activeDays: index + 3,
  recordedWork: Array.from({ length: index + 3 }, (_, day) => ({ key: `work-${day}`, referralId: day + 1, client: `Synthetic Client ${day + 1}`, community: "San Pablo", at: new Date(Date.UTC(2026, 9, 16 + (day * 3 + index) % 28, 20)).toISOString(), detail: "Assessment updated" })),
  usage: index === 7 ? null : { interactions: 200 - index * 20, activeMinutes: 60, days: 4 },
}));
const snapshot = { period: "30d", since: "2026-10-15T07:00:00Z", through: "2026-11-13T20:00:00Z", usageSince: "2026-11-12T20:00:00Z", people, unattributedEvents: 2, unassignedWorkspaces: 1, unassignedGapItems: 4 };

for (const width of [1440, 390, 320]) test(`assessor narratives lead with linked facts and preserve evidence access at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/operations/assessor-scorecard?*", route => route.fulfill({ json: snapshot }));
  await page.goto("/?screen=operations&report=assessor_scorecard");
  const report = page.getByRole("main", { name: "Assessor scorecard", exact: true });
  const reviews = report.getByRole("region", { name: "Assessor usage review", exact: true });
  await expect(reviews.getByRole("article")).toHaveCount(8);
  await expect(report.getByRole("group", { name: "Recorded work comparison", exact: true })).toBeHidden();
  await report.getByRole("combobox", { name: "Sort by" }).selectOption("name");
  const review = reviews.getByRole("article", { name: "Alexandria Montgomery-Washington usage review", exact: true });
  await expect(review.getByText(/Recorded work on/)).toContainText("3 days across 3 client workspaces");
  await expect(review.getByText(/Click tracking covers/)).toContainText("Nov 12–Nov 13");
  const trigger = review.getByRole("button", { name: "View evidence: Alexandria Montgomery-Washington: 3 client workspaces", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog", { name: "Alexandria Montgomery-Washington breakdown", exact: true });
  await expect(detail.getByRole("link")).toHaveCount(3);
  await expect(detail.getByRole("link", { name: "Synthetic Client With A Long Full Name", exact: true })).toHaveAttribute("href", /referralId=1/);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  for (const article of await reviews.getByRole("article").all()) expect(await article.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await report.getByRole("combobox", { name: "Period", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.data/scorecard-narrative-${width}.png` });
  await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: (target: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe.run('[data-testid="operations-workspace"]');
    return result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  });
  expect(violations).toEqual([]);
});

for (const width of [1440, 390]) test(`scorecard priority measures and contained evidence at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const names = ["Alexandria Montgomery-Washington", "Jordan Ellis", "Morgan Reed", "Robin West"];
  const preview = people.slice(0, 4).map((person, index) => ({ ...person, name: names[index], evidence: { ...person.evidence,
    clients: Array.from({ length: 26 }, (_, item) => ({ ...person.evidence.clients[0], key: `client-${item}`, referralId: item + 100, client: `Synthetic Client ${String(item + 1).padStart(2, "0")}` })),
  } }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/operations/assessor-scorecard?*", route => route.fulfill({ json: { ...snapshot, people: preview } }));
  await page.goto("/?screen=operations&report=assessor_scorecard");
  const report = page.getByRole("main", { name: "Assessor scorecard", exact: true });
  await expect(report.getByRole("region", { name: "Assessor usage review" })).toBeVisible();
  await expect(report.getByRole("group", { name: "Recorded work comparison" })).toBeHidden();
  await report.getByText("Compare measures", { exact: true }).click();
  for (const name of ["Days with recorded work", "Days with saved work per week", "Clicks / taps"]) {
    const heading = report.getByRole("heading", { name, exact: true });
    await expect(heading).toBeVisible();

  }
  await expect(report.getByText("One day counts once, whether one change or many were saved. App visits alone do not count.")).toBeVisible();
  await expect.poll(() => report.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  await page.screenshot({ path: `.data/scorecard-clarity-overview-${width}.png` });
  await report.getByRole("combobox", { name: "Measure", exact: true }).selectOption("clients");
  await expect(report.getByRole("heading", { name: "Clients worked on per week", exact: true })).toBeVisible();
  await expect(report.getByText("Each client counts once per week with recorded activity. The same client can count again in another week.")).toBeVisible();
  const trigger = report.getByRole("button", { name: "Alexandria Montgomery-Washington: 26 clients worked" });
  const linkedRow = report.getByRole("button", { name: "Alexandria Montgomery-Washington: 200 clicks / taps", exact: true });
  await trigger.hover();
  await expect(linkedRow).toHaveAttribute("data-highlighted", "true");
  await trigger.click();
  const before = await report.evaluate(node => node.scrollTop);
  const dialog = page.getByRole("dialog", { name: "Alexandria Montgomery-Washington breakdown", exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
  await expect(dialog.getByRole("link")).toHaveCount(20);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `.data/scorecard-clarity-drilldown-${width}.png` });
  await dialog.getByRole("button", { name: "Show more clients" }).click();
  await expect(dialog.getByRole("link")).toHaveCount(26);
  await expect(dialog.getByRole("link", { name: "Synthetic Client 26" })).toHaveAttribute("href", /referralId=125/);
  await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
  expect(await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: (target: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe.run('dialog[open]');
    return result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  })).toEqual([]);
  // Keep the pointer off the charts when testing restored keyboard highlighting.
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await report.evaluate(node => node.scrollTop)).toBe(before);
  await expect(linkedRow).toHaveAttribute("data-highlighted", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  expect(await dialog.evaluate(node => node.getAnimations().length)).toBe(0);
  await dialog.getByRole("button", { name: /Close .* breakdown/ }).click();
  await expect(trigger).toBeFocused();
});

for (const touch of [false, true]) test(`scorecard scrolls inside the report frame with ${touch ? "touch" : "wheel and keyboard"}`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: touch ? 390 : 1440, height: 844 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  try {
    await page.route("**/api/auth/me", route => route.fulfill({ json: { user: owner } }));
    await page.route("**/api/operations/assessor-scorecard?*", route => route.fulfill({ json: snapshot }));
    await page.goto("/?screen=operations&report=assessor_scorecard");
    const report = page.getByRole("main", { name: "Assessor scorecard", exact: true });
    await expect(report.getByRole("region", { name: "Assessor usage review", exact: true })).toBeVisible();
    const bounds = (await report.boundingBox())!;
    if (touch) {
      const session = await context.newCDPSession(page);
      const x = bounds.x + bounds.width / 2;
      const y = Math.min(bounds.y + bounds.height, 844) - 70;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step += 1) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - step * 40 }] });
        await page.waitForTimeout(25);
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 300);
      await page.mouse.wheel(0, 650);
    }
    // Locator clicks/focus can scroll clipped ancestors and hide a broken native scroll area.
    await expect.poll(() => report.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    if (!touch) {
      await page.mouse.wheel(0, 20_000);
      await expect(report.getByText("How this is counted", { exact: true })).toBeInViewport();
      await report.getByRole("button", { name: "Refresh", exact: true }).focus();
      await expect.poll(() => report.evaluate(node => node.scrollTop)).toBe(0);
      await page.keyboard.press("PageDown");
      await expect.poll(() => report.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
    }
    await expect(page.getByRole("navigation", { name: "Reports", exact: true })).toBeInViewport();
  } finally {
    await context.close();
  }
});

for (const width of [1440, 834, 390, 320]) test(`scorecard sorting, evidence, keyboard and readable layout at ${width}px`, async ({ page }) => {
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
  await report.getByText("Compare measures", { exact: true }).click();
  await report.getByRole("combobox", { name: "Measure", exact: true }).selectOption("confirmed");
  const work = report.getByRole("region", { name: "Assessments confirmed", exact: true });
  await expect(work.getByText("Alexandria Montgomery-Washington", { exact: true })).toBeVisible();
  await page.setViewportSize({ width, height: 960 });
  await expect(report.getByRole("combobox", { name: "Sort by" })).toHaveValue("days");
  await expect(work.getByRole("heading", { name: "Assessments confirmed", exact: true })).toBeVisible();
  await report.getByRole("combobox", { name: "Sort by" }).selectOption("name");
  await expect(work.getByRole("listitem").first()).toContainText("Alexandria Montgomery-Washington");
  await expect(work.getByRole("listitem")).toHaveCount(8);
  expect(await report.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  for (const row of await work.getByRole("listitem").all()) expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await report.getByRole("combobox", { name: "Period", exact: true }).selectOption("launch");
  await expect.poll(() => periods.at(-1)).toBe("launch");
  await report.getByRole("button", { name: "Alexandria Montgomery-Washington: 3 items to complete" }).click();
  const breakdown = page.getByRole("dialog", { name: "Alexandria Montgomery-Washington breakdown", exact: true });
  await expect(breakdown).toBeVisible();
  expect(await breakdown.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect(breakdown.getByText("Record referring county").first()).toBeVisible();
  await expect(breakdown.getByRole("link", { name: "Synthetic Client With A Long Full Name" })).toHaveAttribute("href", /referralId=1&workspaceStage=chart/);
  await breakdown.getByRole("combobox", { name: "Work measures" }).selectOption("confirmed");
  await expect(breakdown.getByRole("heading", { name: "Assessments confirmed" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(breakdown).toHaveCount(0);
  await expect(report.getByRole("button", { name: "Alexandria Montgomery-Washington: 3 items to complete" })).toBeFocused();
  await work.getByLabel("How assessments confirmed are counted").click();
  await expect(work.getByText(/Later confirmations add no credit/)).toBeVisible();
  await work.getByLabel("How assessments confirmed are counted").click();
  const usage = report.getByRole("region", { name: "Clicks / taps", exact: true });
  await expect(usage.getByRole("button", { name: "Synthetic Assessor 8: not tracked" })).toBeVisible();
  await usage.getByRole("button", { name: "Alexandria Montgomery-Washington: 200 clicks / taps" }).click();
  await expect(breakdown.getByText("Usage is not linked to client records.", { exact: false })).toBeVisible();
  await expect(breakdown.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(breakdown).toHaveCount(0);
  await expect(report.getByRole("region", { name: "Recent recorded work", exact: true })).toHaveCount(0);
  const trend = report.getByRole("region", { name: "Assessments confirmed per week", exact: true });
  await expect(trend.getByText("First chart confirmations, credited to the assessor who confirmed. Later confirmations do not add to the count.")).toBeVisible();
  await report.getByRole("group", { name: "Assessor to explore" }).getByRole("button", { name: "Alexandria Montgomery-Washington", exact: true }).click();
  const week = report.getByRole("button", { name: /Alexandria Montgomery-Washington: 3 assessments confirmed, week beginning Nov 9/ }).filter({ visible: true });
  await week.focus(); await page.keyboard.press("Enter");
  await expect(breakdown).toBeVisible();
  expect(await breakdown.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect(breakdown.getByRole("link")).toHaveCount(3);
  await expect(breakdown.getByRole("heading", { name: /Assessments confirmed · Nov 9/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(breakdown).toHaveCount(0);
  await expect(week).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `.data/scorecard-detail-${width}.png` });
  await report.getByText("How this is counted", { exact: true }).click();
  await expect(report.getByText(/Notes have no complete author history/)).toBeVisible();
  await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: (target: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe.run('[data-testid="operations-workspace"]');
    return result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  });
  expect(violations).toEqual([]);
  await report.getByRole("combobox", { name: "Period", exact: true }).scrollIntoViewIfNeeded();
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
  await page.getByText("How this is counted", { exact: true }).click();
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
  await expect(page.getByRole("region", { name: "Assessor usage review", exact: true })).toBeVisible();
  await tabs.getByRole("link", { name: "Admissions & census", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Admissions & census" })).toBeVisible();
  await page.goBack();
  await expect(tabs.getByRole("link", { name: "Assessor scorecard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Assessor usage review", exact: true })).toBeVisible();
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


test("Andrew can open the same report and export without gaining the private activity dashboard", async ({ page }) => {
  const andrew = { ...owner, id: "e9f39185-d751-45c0-bcf5-c24d3565bdd9", email: "andrew@example.invalid", name: "Andrew" };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { user: andrew } }));
  await page.route("**/api/operations/assessor-scorecard?*", route => route.fulfill({ json: snapshot }));
  await page.goto("/?screen=operations");
  await page.getByRole("navigation", { name: "Reports", exact: true }).getByRole("link", { name: "Assessor scorecard", exact: true }).click();
  const report = page.getByRole("main", { name: "Assessor scorecard", exact: true });
  await expect(report.getByRole("combobox", { name: "Period", exact: true })).toHaveValue("launch");
  await expect(report.getByRole("button", { name: "Export PDF" })).toBeVisible();
  await expect(report.getByRole("region", { name: "Assessor usage review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Application activity", exact: true })).toHaveCount(0);
});
