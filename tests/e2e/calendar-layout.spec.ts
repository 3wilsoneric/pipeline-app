import { expect, test, type Page } from "@playwright/test";

async function openCalendar(page: Page, outsideHours = false) {
  await page.clock.setFixedTime(new Date("2026-09-18T18:00:00Z"));
  await page.route("**/api/calendar/events**", (route) => route.fulfill({ json: {
    events: Array.from({ length: 12 }, (_, index) => ({
      id: `layout-${index}`, assessmentId: `layout-${index}`, assessmentVersion: 1,
      referralId: 800 + index, clientName: `Sample ${["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima"][index]}`, community: "San Pablo",
      ownerId: "assessor-a", owner: "Annette Everhart", date: "2026-09-18",
      startsAt: outsideHours && index < 2 ? ["2026-09-18T13:00:00Z", "2026-09-19T04:00:00Z"][index] : `2026-09-18T${String(15 + index % 7).padStart(2, "0")}:00:00Z`,
      durationMinutes: 60, method: "phone", location: "555-0100",
      scheduleStatus: "scheduled", kind: "assessment", status: "draft", title: "Assessment scheduled",
    })),
    continuing: [], unscheduled: [], unscheduledTotal: 0, unscheduledHasMore: false,
    assessors: [{ id: "assessor-a", name: "Annette Everhart" }],
    viewer: { id: "assessor-a", name: "Annette Everhart" }, scope: "team", timezone: "America/Los_Angeles",
  } }));
  await page.goto("/?screen=calendar");
  await expect(page.getByRole("main", { name: "Calendar", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("Sample Alpha", { exact: true })).toBeVisible();
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 834, height: 900 }, { width: 437, height: 536 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`compact controls scroll with the whole calendar at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const { width } = viewport;
    await page.setViewportSize(viewport);
    await openCalendar(page);
    const workspace = page.locator('[data-guide-target="calendar-workspace"]');
    const controls = page.locator('header[aria-label="Calendar controls"]');
    const sheet = page.getByRole("region", { name: "Calendar entries", exact: true });
    const before = (await controls.boundingBox())!;
    expect(before.height).toBeLessThan(width >= 1000 ? 80 : 130);
    const workspaceBounds = (await workspace.boundingBox())!;
    expect(workspaceBounds.y + workspaceBounds.height - before.y - before.height).toBeGreaterThan(240);
    await expect(controls.getByLabel("Filter calendar by community")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const name of ["Previous calendar range", "Next calendar range", "Today", "Show calendar filters", "Scheduling queue 0"]) {
      const bounds = (await controls.getByRole("button", { name, exact: true }).boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: testInfo.outputPath(`calendar-header-${width}.png`) });
    const viewControl = width < 621 ? controls.getByRole("combobox", { name: "Calendar view" }) : controls.getByRole("button", { name: "week", exact: true });
    expect((await viewControl.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.mouse.move(workspaceBounds.x + workspaceBounds.width / 2, workspaceBounds.y + workspaceBounds.height * .7);
    await page.mouse.wheel(0, 550);
    await expect.poll(() => workspace.evaluate((node) => node.scrollTop)).toBeGreaterThan(before.height);
    expect((await controls.boundingBox())!.y).toBeLessThan(before.y - before.height);
    await expect(controls).not.toBeInViewport();
    expect(await sheet.evaluate((node) => node.scrollTop)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`calendar-page-scrolled-${width}.png`) });
    await workspace.focus();
    await page.keyboard.press("End");
    await expect.poll(() => workspace.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
    const lastAppointment = sheet.getByText("Sample Lima", { exact: true });
    await lastAppointment.scrollIntoViewIfNeeded();
    await expect(lastAppointment).toBeInViewport();
    await controls.getByRole("button", { name: "Show calendar filters" }).click();
    await expect(controls.getByLabel("Filter calendar by community")).toBeVisible();
    await controls.getByLabel("Filter calendar by community").selectOption("San Pablo");
    await expect(controls.getByLabel("Filter calendar by community")).toHaveValue("San Pablo");
    await expect(controls.getByRole("button", { name: "Refresh calendar" })).toBeVisible();
    await controls.getByRole("button", { name: "Show calendar filters" }).click();
  });
}

test("week pans horizontally without trapping vertical scroll and restores page position on return", async ({ page }, testInfo) => {
  await openCalendar(page);
  await page.setViewportSize({ width: 834, height: 900 });
  await page.getByRole("button", { name: "week", exact: true }).click();
  const sheet = page.getByTestId("calendar-sheet");
  const workspace = page.locator('[data-guide-target="calendar-workspace"]');
  const week = page.getByRole("region", { name: "Timed assessment week" });
  const heading = week.locator("[data-calendar-week-heading]");
  await expect(heading).toBeVisible();
  const headingTop = (await heading.boundingBox())!.y;
  const initialScroll = await workspace.evaluate((node) => node.scrollTop);
  await week.evaluate((node) => { node.scrollLeft = 250; });
  await workspace.evaluate((node) => { node.scrollTop = 350; });
  const savedScroll = await workspace.evaluate((node) => node.scrollTop);
  expect(savedScroll).toBeGreaterThan(100);
  expect((await heading.boundingBox())!.y).toBeCloseTo(headingTop - (savedScroll - initialScroll), 0);
  expect(await sheet.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await week.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThan(2);
  const ruler = week.getByText("7 AM", { exact: true }).locator("..");
  expect(Math.abs((await ruler.boundingBox())!.x - (await week.boundingBox())!.x)).toBeLessThan(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("calendar-week-scrolled-ipad.png") });
  await page.getByRole("button", { name: "Open client profiles" }).click();
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await expect(page.getByRole("button", { name: "week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => workspace.evaluate((node) => node.scrollTop)).toBeCloseTo(savedScroll, 0);
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "September 2026" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("date details preserve Week and Month, keyboard return, and appointments outside grid hours", async ({ page }) => {
  await openCalendar(page, true);
  const otherTimes = page.getByRole("region", { name: "Other appointment times", exact: true });
  await expect(otherTimes).toContainText("6:00 AM");
  await expect(otherTimes).toContainText("9:00 PM");
  const friday = page.getByRole("button", { name: "Show appointments for Friday, Sep 18", exact: true });
  await friday.click();
  const details = page.getByRole("region", { name: /^Appointments on / });
  await expect(details).toBeFocused();
  await expect(details.getByRole("button", { name: /^Appointment details for / })).toHaveCount(12);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(friday).toBeFocused();
  await expect(page.getByRole("button", { name: "week", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show appointments for Thursday, Sep 17", exact: true }).click();
  await expect(details).toContainText("No appointments on your schedule for this date.");
  await page.getByRole("button", { name: "month", exact: true }).click();
  await expect(details).toHaveCount(0);
  const nextMonth = page.waitForRequest((request) => request.url().includes("/api/calendar/events?") && new URL(request.url()).searchParams.get("from") === "2026-10-01");
  await page.getByRole("button", { name: "Show appointments for Thursday, Oct 1", exact: true }).click();
  await nextMonth;
  await expect(page.getByRole("heading", { level: 1, name: "October 2026" })).toBeVisible();
  await expect(details).toHaveAccessibleName("Appointments on Thursday, Oct 1");
  await expect(page.getByRole("button", { name: "month", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Safari uses a readable weekly list and compact phone month instead of a wide grid", async ({ playwright, baseURL }, testInfo) => {
  const browser = await playwright.webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 437, height: 536 }, hasTouch: true });
    await openCalendar(page);
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByLabel("Filter calendar by community").selectOption("San Pablo");
    await page.getByRole("button", { name: "Show calendar filters" }).click();
    await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("week");
    const sheet = page.getByTestId("calendar-sheet");
    const heading = page.getByRole("button", { name: /Show appointments for Friday, Sep 18/ });
    await expect(heading).toBeVisible();
    const controls = page.locator('header[aria-label="Calendar controls"]');
    expect((await controls.boundingBox())!.height).toBeLessThan(130);
    const workspace = page.locator('[data-guide-target="calendar-workspace"]');
    const week = page.getByRole("region", { name: "Week appointments" });
    await expect(page.getByRole("region", { name: "Timed assessment week" })).toHaveCount(0);
    const before = (await heading.boundingBox())!.y;
    const bounds = (await workspace.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * .7);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => workspace.evaluate((node) => node.scrollTop)).toBeGreaterThan(200);
    expect((await heading.boundingBox())!.y).toBeLessThan(before - 200);
    await expect(controls).not.toBeInViewport();
    expect(await sheet.evaluate((node) => node.scrollTop)).toBe(0);
    expect(await week.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThan(2);
    await workspace.evaluate((node) => { node.scrollTop = 0; });
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("calendar-safari-phone.png") });
    await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("month");
    await expect(page.getByRole("button", { name: "Show appointments for Friday, Sep 18", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("calendar-month-grid-phone.png") });
    await page.getByRole("button", { name: /Show appointments for Friday, Sep 18/ }).click();
    const details = page.getByRole("region", { name: /^Appointments on / });
    await expect(details.getByRole("button", { name: /^Appointment details for / })).toHaveCount(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("calendar-month-phone.png") });
  } finally {
    await browser.close();
  }
});
