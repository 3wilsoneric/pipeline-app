import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";

test.use({ serviceWorkers: "block", timezoneId: "UTC" });

test("personal week uses Pacific dates, full results and assessor identity through DST", async ({ page }, info) => {
  await page.clock.setFixedTime(new Date("2026-11-01T18:00:00Z"));
  const { viewer } = await (await page.request.get("/api/operations/home")).json();
  const event = { kind: "assessment", status: "scheduled", scheduleStatus: "scheduled", method: "zoom", community: "San Pablo", ownerId: viewer.id, owner: viewer.name };
  const requests: string[] = [];
  await page.route("**/api/calendar/events?**", async route => {
    const from = new URL(route.request().url()).searchParams.get("from")!;
    requests.push(from);
    const events = [
      { ...event, id: "dst-first", referralId: 910601, clientName: "First one thirty", date: "2026-11-01", startsAt: "2026-11-01T08:30:00Z" },
      { ...event, id: "dst-second", referralId: 910602, clientName: "Second one thirty", date: "2026-11-01", startsAt: "2026-11-01T09:30:00Z" },
      { ...event, id: "late-night", referralId: 910603, clientName: "Late evening", date: "2026-11-01", startsAt: "2026-11-02T07:30:00Z" },
      { ...event, id: "legacy", referralId: 910604, clientName: "Legacy assigned", ownerId: undefined, date: "2026-11-02", startsAt: "2026-11-02T18:00:00Z" },
      { ...event, id: "legacy-email", referralId: 910609, clientName: "Email assigned", ownerId: undefined, owner: "playwright@pipeline.local", date: "2026-11-02", startsAt: "2026-11-02T19:00:00Z" },
      { ...event, id: "team", referralId: 910605, clientName: "Other assessor", ownerId: "another-assessor", date: "2026-11-02", startsAt: "2026-11-02T18:00:00Z" },
      { ...event, id: "completed", referralId: 910606, clientName: "Completed appointment", status: "complete", scheduleStatus: "completed", date: "2026-11-01", startsAt: "2026-11-01T17:00:00Z" },
      { ...event, id: "next-week", referralId: 910607, clientName: "Next week client", date: "2026-11-08", startsAt: "2026-11-08T18:00:00Z" },
      { ...event, id: "assignment", referralId: 910608, clientName: "Assignment only", kind: "referral_assigned", date: "2026-11-01" },
    ];
    await route.fulfill({ json: { viewer, scope: "team", events } });
  });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Upcoming assessments", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Upcoming assessments", exact: true });
  await expect(dialog).toHaveAttribute("data-origin-motion", "true");
  const sunday = dialog.locator('[data-calendar-day="2026-11-01"]');
  await expect(sunday.getByRole("button", { name: /one thirty/i })).toHaveCount(2);
  await expect(sunday.getByText("1:30 AM", { exact: true })).toHaveCount(2);
  await expect(sunday.getByRole("button", { name: /Late evening/i })).toContainText("11:30 PM");
  await expect(dialog.getByRole("button", { name: /Legacy assigned/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Email assigned/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Completed appointment/i })).toContainText("Completed");
  await expect(dialog.getByRole("button", { name: /Other assessor|Assignment only|Next week client/i })).toHaveCount(0);
  await expect(dialog.locator("[aria-current=date]")).toHaveAttribute("datetime", "2026-11-01");
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run("dialog[open]", { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  await dialog.screenshot({ path: info.outputPath("personal-week-desktop.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Next calendar range" }).click();
  await expect(dialog.getByRole("button", { name: /Next week client/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /one thirty/i })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Today", exact: true }).click();
  await expect(sunday.getByRole("button", { name: /one thirty/i })).toHaveCount(2);
  await dialog.getByRole("button", { name: "Previous calendar range" }).click();
  await expect(dialog.getByText("No assessments scheduled this week.")).toBeVisible();
  expect(requests).toEqual(["2026-11-01", "2026-11-08", "2026-11-01", "2026-10-25"]);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("calendar failure can retry without becoming an empty week; reduced motion keeps focus", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { viewer } = await (await page.request.get("/api/operations/home")).json();
  let available = false;
  await page.route("**/api/calendar/events?**", route => available
    ? route.fulfill({ json: { viewer, events: [] } })
    : route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Upcoming assessments", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Upcoming assessments", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Upcoming assessments are unavailable.");
  await expect(dialog.getByText("No assessments scheduled this week.")).toHaveCount(0);
  available = true;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByText("No assessments scheduled this week.")).toBeVisible();
  expect(await dialog.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0);
  await dialog.getByRole("button", { name: "Close upcoming assessments", exact: true }).click();
  await expect(opener).toBeFocused();
});
