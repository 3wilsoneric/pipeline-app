import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", name: "Eric", roles: ["admin"] };
const person = { id: "fixture-assessor", name: "Synthetic Assessor", email: "assessor@example.invalid", last_seen_at: "2026-09-26T03:00:00Z", last_sign_in_at: "2026-09-26T02:00:00Z", sign_ins: 1, recorded_actions: 2 };
const event = { id: "first", actor_id: person.id, actor_name: person.name, action: "referral_updated", entity_type: "referral", entity_id: "42", fields: ["Primary assignee", "Admission date"], created_at: "2026-09-26T03:00:00Z", workspace: { id: 42, name: "Synthetic Client", deleted: false } };

for (const width of [1440, 1024, 390]) test(`owner activity is readable, filterable and accessible at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  await page.route("**/api/operations/azure-usage", (route) => route.fulfill({ json: {
    sampledAt: new Date().toISOString(), cpuPercent: 8.2, memoryPercent: 27.4,
    activeConnections: 9, cpuPeakHourPercent: 34.4,
  } }));
  await page.route("**/api/operations/assessor-status?*", (route) => route.fulfill({ json: { people: [
    { id: "online", name: "Andrew", status: "online" },
    { id: "today", name: "Jazmine", status: "today" },
    { id: "away", name: "Vince", status: "away" },
  ] } }));
  const queries: URLSearchParams[] = [];
  await page.route("**/api/operations/application-activity?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params);
    const more = Boolean(params.get("cursor"));
    return route.fulfill({ json: { since: params.get("since"), through: params.get("through"), people: [person], events: [{ ...event, id: more ? "second" : "first", action: more ? "assessment_signed" : "referral_updated", entity_type: more ? "assessment" : "referral" }], next_cursor: more ? null : "synthetic-cursor" } });
  });
  await page.goto("/");
  const meter = page.getByRole("region", { name: "Live database usage" });
  await expect(meter.getByText("Database usage")).toBeVisible();
  await expect(meter.getByText("8.2%")).toBeVisible();
  await expect(meter.getByText("Highest 1-minute CPU average in the past hour: 34.4%.")).toBeVisible();
  expect(await meter.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.addScriptTag({ content: axeSource });
  const meterViolations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe;
    return (await axe.run('section[aria-label="Live database usage"]')).violations.filter((item) => ["serious", "critical"].includes(item.impact));
  });
  expect(meterViolations).toEqual([]);
  const card = page.getByRole("button", { name: "Open application activity" });
  await expect(card.locator('[data-status="online"]')).toContainText("Andrew");
  await expect(card.locator('[data-status="today"]')).toContainText("Jazmine");
  await expect(card.locator('[data-status="away"]')).toContainText("Vince");
  await expect(card).toHaveAttribute("aria-describedby", /.+/);
  expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const cardBox = (await card.boundingBox())!;
  const meterBox = (await meter.boundingBox())!;
  if (width >= 1024) {
    expect(Math.abs(cardBox.y - meterBox.y)).toBeLessThan(2);
    expect(meterBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 2);
    if (width === 1440) expect(Math.max(cardBox.height, meterBox.height)).toBeLessThan(150);
  } else {
    expect(meterBox.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height);
  }
  const ribbonViolations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe;
    return (await axe.run('button[aria-label="Open application activity"]')).violations.filter((item) => ["serious", "critical"].includes(item.impact));
  });
  expect(ribbonViolations).toEqual([]);
  await card.screenshot({ path: `.data/activity-ribbon-${width}.png` });
  await page.screenshot({ path: `.data/activity-widgets-${width}.png` });
  await card.click();
  const dialog = page.getByRole("dialog", { name: "Application activity", exact: true });
  await expect(dialog.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await expect(dialog.getByText("1 sign-ins · 2 actions")).toBeVisible();
  await expect(dialog.getByText("Changed: Primary assignee, Admission date")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Synthetic Client · Workspace #42" })).toHaveAttribute("href", /referralId=42/);
  await dialog.getByRole("button", { name: "Load more" }).click();
  await expect(dialog.getByText("Assessment signed", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Person", exact: true }).selectOption(person.id);
  await expect.poll(() => queries.at(-1)?.get("actor")).toBe(person.id);
  await dialog.getByRole("combobox", { name: "Period", exact: true }).selectOption("7");
  await expect.poll(() => Date.parse(queries.at(-1)!.get("through")!) - Date.parse(queries.at(-1)!.get("since")!)).toBe(7 * 86400_000);
  await expect(dialog.getByText("Changed: Primary assignee, Admission date")).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: string) => Promise<{ violations: { impact: string; id: string }[] }> } }).axe;
    return (await axe.run('dialog[open]')).violations.filter((item) => ["serious", "critical"].includes(item.impact));
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: `.data/activity-${width}.png` });
  await dialog.getByRole("button", { name: "Close application activity" }).click();
  await expect(card).toBeFocused();
});

test("other admins do not get the card or access to the reporting endpoint", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: { ...owner, id: "another-admin", email: "someone@example.invalid" } } }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open application activity" })).toHaveCount(0);
  const result = await page.request.get(`/api/operations/application-activity?since=${new Date().toISOString()}`);
  expect(result.status()).toBe(403);
  const status = await page.request.get(`/api/operations/assessor-status?since=${new Date().toISOString()}`);
  expect(status.status()).toBe(403);
});

test("activity failure stays inside the dialog and can be retried", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: owner } }));
  let fails = true;
  await page.route("**/api/operations/application-activity?*", (route) => route.fulfill(fails ? { status: 503, json: { error: "Activity is temporarily unavailable." } } : { json: { since: new Date().toISOString(), through: new Date().toISOString(), people: [], events: [], next_cursor: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Open application activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Application activity", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Activity could not be loaded");
  fails = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("No recorded activity in this period.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close application activity" }).click();
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
});
